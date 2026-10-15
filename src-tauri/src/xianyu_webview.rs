//! 闲鱼搜索页取价：复用 WebView2 会话，拦截搜索响应并读取商品价格。
//! 使用原生 eval_with_callback 回传 JSON，避免远程 IPC/CSP 和 URL fragment 编码问题。

use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// 这扇 webview 的 label。全 App 只有一扇，一直复用
const LABEL: &str = "xianyu";
/// 搜索页地址。keyword 会做百分号编码
const SEARCH_URL: &str = "https://www.goofish.com/search?q=";
/// 等多久还没认到价格就判定失败
const TIMEOUT: Duration = Duration::from_secs(45);
/// 两次轮询之间的间隔
const POLL_EVERY: Duration = Duration::from_millis(700);
/// 原始响应存多少字下来做排查。够看清结构，又不至于把文件撑爆
const RAW_KEEP: usize = 2_000_000;

fn retain_session_on_close(window: &tauri::WebviewWindow) {
    let hidden = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = hidden.hide();
        }
    });
}

/// 一次抓取的结果摘要
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchSummary {
    pub ok: bool,
    pub needs_verification: bool,
    /// 认出几个在售价
    pub count: usize,
    pub avg: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// 服务器的 ret 原话
    pub ret: String,
    pub message: String,
}

fn needs_verification(ret: &str) -> bool {
    let ret = ret.to_ascii_uppercase();
    [
        "RGV587",
        "USER_VALIDATE",
        "USER_LOGIN",
        "SESSION_EXPIRED",
        "NEED_LOGIN",
    ]
    .iter()
    .any(|code| ret.contains(code))
}

/// 抓价过程的流水。界面上一句话说不清发生了什么，这里留一份，
/// 超时时原样带出来，不依赖用户去翻 dev 终端。
///
/// 以前这里还存着「等谁回报」的等待状态；改成 Rust 主动轮询之后，
/// 结果一直握在命令自己手里，留给这扇窗共享的就只剩流水了。
#[derive(Default)]
pub struct XianyuWait {
    log: Mutex<Vec<String>>,
    fetch_lock: tokio::sync::Mutex<()>,
}

impl XianyuWait {
    fn begin(&self) {
        self.log.lock().clear();
    }
    fn note(&self, line: String) {
        let mut g = self.log.lock();
        // 一次抓价不该刷出几十行；多了前头的就没意义了
        if g.len() >= 30 {
            g.remove(0);
        }
        g.push(line);
    }
    fn logs(&self) -> String {
        let g = self.log.lock();
        if g.is_empty() {
            "（一条流水都没有，页面加载回调可能压根没触发）".to_string()
        } else {
            g.join("\n")
        }
    }
}

/// 注入页面的脚本。
///
/// 只抓东西，**不 invoke、不用定时器、不发话**——回传由 Rust 用 `eval`
/// 主动来取（见模块开头）。
pub(crate) const HOOK_JS: &str = r#"
(function () {
  if (window.__xyHooked) return;
  window.__xyRaw = '';
  window.__xyRawUrl = '';
  window.__xyRawRet = '';

  function onResponse(url, body) {
    if (!url || url.indexOf('idlemtopsearch.pc.search') < 0 ||
        url.indexOf('activate') >= 0 || url.indexOf('shade') >= 0) return;
    if (!body) return;
    var text = String(body).slice(0, 2000000);
    // 搜索页同时请求激活词、shade 等辅助接口；它们不是商品列表，不能覆盖真正结果。
    var ret = '';
    try {
      var parsed = JSON.parse(text);
      var api = String(parsed.api || '');
      if (api && (api.indexOf('idlemtopsearch.pc.search') < 0 ||
                  api.indexOf('activate') >= 0 || api.indexOf('shade') >= 0)) return;
      ret = (parsed.ret || []).join('; ');
    } catch (e) {}
    window.__xyRawUrl = String(url);
    window.__xyRaw = text;
    window.__xyRawRet = ret;
  }

  // 读 XHR 响应体。不能直接摸 responseText：responseType 是 'json' 时
  // 读它会抛 InvalidStateError，而闲鱼怎么设的 responseType 没验证过。
  function readBody(x) {
    var rt = x.responseType;
    if (rt === '' || rt === 'text') {
      try { return x.responseText; } catch (e) {}
    }
    try { if (typeof x.response === 'string') return x.response; } catch (e) {}
    try { if (x.response != null) return JSON.stringify(x.response); } catch (e) {}
    return '';
  }

  var xhrOpen = XMLHttpRequest.prototype.open;
  var xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) {
    this.__xyUrl = String(url);
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var x = this;
    x.addEventListener('load', function () {
      try { onResponse(x.__xyUrl, readBody(x)); } catch (e) {}
    });
    return xhrSend.apply(x, arguments);
  };

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var p = origFetch.apply(this, arguments);
      try {
        if (url.indexOf('idlemtopsearch') >= 0) {
          p.then(function (res) {
            return res.clone().text().then(function (t) { onResponse(url, t); });
          }).catch(function () {});
        }
      } catch (e) {}
      return p;
    };
  }

  // 读渲染出来的价格。匹配规则只有一条：**整段文字就是一个 ¥+数字**。
  //  - 整段匹配（^...$）杜绝把「想要 12 人」「已售 300 件」混进来
  //  - 出现「万」的单位解析不了（1.2万 到底多少），这个正则直接不收，
  //    宁可少收，也不能算出一个看起来很精确的错数
  var PRICE_RE = /^[¥￥]\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)$/;

  function scanPrices(keyword) {
    var terms = String(keyword || '').toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]+/g) || [];
    if (!terms.length) return [];
    var unwanted = /配件|保护壳|保护套|保护膜|贴膜|收纳包|收纳盒|挂绳|支架|充电器|充电线|充电头|镜头盖|转接环|滤镜|空盒|包装盒|纸盒|定金|订金|拍下改价|维修|故障|不含主机|仅外壳|图纸|模型|仅链接|配件单出|单卖配件/;
    var all = document.body ? document.body.querySelectorAll('*') : [];
    var hits = [];
    for (var i = 0; i < all.length; i++) {
      var node = all[i];
      var t = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length < 2 || t.length > 18) continue;
      if (!PRICE_RE.test(t)) continue;
      var n = parseFloat(t.replace(/^[¥￥]\s*/, '').replace(/,/g, ''));
      if (!isFinite(n) || n < 1 || n > 1000000) continue;
      // 只把价格归属到标题含全部搜索词的商品卡片，排除无关商品、配件和定金。
      var card = node;
      var cardText = '';
      for (var depth = 0; card && depth < 9; depth++, card = card.parentElement) {
        var candidate = (card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim();
        if (candidate.length > 2 && candidate.length <= 450 &&
            terms.every(function (term) { return candidate.toLowerCase().indexOf(term) >= 0; })) {
          cardText = candidate;
          break;
        }
      }
      if (!cardText || unwanted.test(cardText)) continue;
      hits.push({ el: node, n: n });
    }
    // 只留最内层的那一个。外层容器会把内层的文字原样抄一遍
    // （卡片里只有一件商品时，容器整段就等于那个价格），
    // 两个都收的话同一件商品会被算两遍，均价直接被带偏。
    //
    // 这里**不能**写成「只看没有子元素的」：闲鱼要是把价格拆成
    // <div>¥<span>1317.94</span></div>，那条规则会把整个价格漏光。
    var out = [];
    for (var j = 0; j < hits.length; j++) {
      var dup = false;
      for (var k = 0; k < hits.length; k++) {
        // 按**元素身份**跳过自己，不是按下标。contains(a, a) 为真，
        // 只比下标的话同一个元素出现两次就会被自己判成「被包含」而整个丢掉
        if (hits[k].el === hits[j].el) continue;
        if (hits[j].el.contains && hits[j].el.contains(hits[k].el)) { dup = true; break; }
      }
      if (!dup) out.push(hits[j].n);
    }
    return out;
  }

  window.__xyScan = scanPrices;
  window.__xyHooked = true;
})();
"#;

/// 原生执行结果回调，不写入页面地址，也不经过页面的 invoke/fetch 通道。
const POLL_JS: &str = r#"
(function () {
  var prices = [];
  try { if (window.__xyScan) prices = window.__xyScan(__XY_KEYWORD_JSON__); } catch (e) {}
  return {
    prices: prices,
    hooked: !!window.__xyHooked,
    raw: window.__xyRaw || '',
    raw_url: window.__xyRawUrl || '',
    raw_ret: window.__xyRawRet || '',
    page_title: document.title,
    page_url: location.href.split('#')[0]
  };
})();
"#;

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct Poll {
    pub prices: Vec<f64>,
    pub hooked: bool,
    pub raw: String,
    pub raw_ret: String,
    pub page_title: String,
    pub page_url: String,
}

fn is_search_page(page_url: &str, keyword: &str, request_id: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(page_url) else {
        return false;
    };
    url.host_str() == Some("www.goofish.com")
        && url.path() == "/search"
        && url
            .query_pairs()
            .any(|(key, value)| key == "q" && value == keyword)
        && url
            .query_pairs()
            .any(|(key, value)| key == "_ge_probe" && value == request_id)
}

async fn read_poll(w: &tauri::WebviewWindow, keyword: &str) -> Result<Poll, String> {
    let keyword_json = serde_json::to_string(keyword).map_err(|e| e.to_string())?;
    let script = POLL_JS.replace("__XY_KEYWORD_JSON__", &keyword_json);
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = Mutex::new(Some(tx));
    w.eval_with_callback(&script, move |result| {
        if let Some(tx) = tx.lock().take() {
            let _ = tx.send(result);
        }
    })
    .map_err(|e| format!("执行页面采集失败：{e}"))?;
    let result = tokio::time::timeout(Duration::from_secs(3), rx)
        .await
        .map_err(|_| "页面执行回调超时".to_string())?
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&result).map_err(|e| format!("页面尚未就绪：{e}"))
}

/// 关键词 → 搜索页地址。
///
/// 中文关键词必须百分号编码，否则 WebView 拿到的是乱码的 URL，
/// 闲鱼会回一个空结果页，看起来就像「这个牌子没人卖」。
pub fn search_url(keyword: &str) -> String {
    format!("{SEARCH_URL}{}", urlencode(keyword.trim()))
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            // 中文占 3 个字节，逐字节转义，别按字符转
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 从闲鱼的原始响应里把在售价抠出来。
///
/// **不能写死字段路径**：这份 JSON 的结构没有可信样本，所以这里用
/// 「键名正好是 `price` 且值是数字或数字串」这种宽口径递归去捞。
///
/// 为什么不用「键名含 price」：那样会把 `originPrice`、`discountPrice`、
/// `shippingPrice` 一并捞进来，均价会被系统性带偏。宁可少捞，
/// 也不能算出一个看起来很精确的错数。
pub fn extract_prices(raw: &str) -> Vec<f64> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let results = json.pointer("/data/resultList").unwrap_or(&json);
    walk(results, &mut out);
    // 一条搜索结果里最多几十个价格，兜个上限免得响应里混进大数组把内存吃光
    out.truncate(200);
    out
}

/// 搜索接口只收标题确实匹配关键词的商品卡片，避免把同一响应里的推荐项/配件算进均价。
fn extract_matching_prices(raw: &str, keyword: &str) -> Vec<f64> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let Some(results) = json.pointer("/data/resultList").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let terms: Vec<String> = keyword
        .split_whitespace()
        .map(|term| term.to_lowercase())
        .filter(|term| !term.is_empty())
        .collect();
    let unwanted = [
        "配件",
        "保护壳",
        "保护套",
        "保护膜",
        "贴膜",
        "收纳包",
        "收纳盒",
        "挂绳",
        "支架",
        "充电器",
        "充电线",
        "充电头",
        "镜头盖",
        "转接环",
        "滤镜",
        "空盒",
        "包装盒",
        "纸盒",
        "定金",
        "订金",
        "拍下改价",
        "维修",
        "故障",
        "不含主机",
        "仅外壳",
        "图纸",
        "模型",
        "仅链接",
        "配件单出",
        "单卖配件",
    ];
    let mut out = Vec::new();
    for item in results {
        let mut titles = Vec::new();
        collect_titles(item, &mut titles);
        let title = titles.join(" ").to_lowercase();
        if title.is_empty()
            || !terms.iter().all(|term| title.contains(term))
            || unwanted.iter().any(|word| title.contains(word))
        {
            continue;
        }
        walk(item, &mut out);
    }
    out.truncate(200);
    out
}

fn collect_titles(v: &serde_json::Value, out: &mut Vec<String>) {
    match v {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                if matches!(
                    key.to_ascii_lowercase().as_str(),
                    "title" | "subject" | "itemtitle" | "item_title"
                ) {
                    if let Some(title) = value.as_str() {
                        out.push(title.to_string());
                    }
                }
                collect_titles(value, out);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_titles(item, out);
            }
        }
        _ => {}
    }
}

fn walk(v: &serde_json::Value, out: &mut Vec<f64>) {
    match v {
        serde_json::Value::Object(map) => {
            for (k, val) in map {
                if k.eq_ignore_ascii_case("price") {
                    if let Some(p) = as_price(val) {
                        out.push(p);
                        continue;
                    }
                }
                walk(val, out);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                walk(item, out);
            }
        }
        _ => {}
    }
}

/// 价格既可能是数字，也可能是 `"1317.94"` 这种字符串（淘系接口的老毛病）
fn as_price(v: &serde_json::Value) -> Option<f64> {
    let n = match v {
        serde_json::Value::Number(n) => n.as_f64()?,
        serde_json::Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                return None;
            }
            t.trim_start_matches(['¥', '￥'])
                .trim()
                .replace(',', "")
                .parse::<f64>()
                .ok()?
        }
        _ => return None,
    };
    // 价格区间上下限、运费、0 元占位都会混进来，按 plausibility 挡掉
    if n.is_finite() && (1.0..=1_000_000.0).contains(&n) {
        Some(n)
    } else {
        None
    }
}

/// 均价 / 最低 / 最高。全都按两位小数收，和 `db::prices` 那边一致
fn summarize(prices: &[f64]) -> (Option<f64>, Option<f64>, Option<f64>) {
    if prices.is_empty() {
        return (None, None, None);
    }
    let sum: f64 = prices.iter().sum();
    let round = |v: f64| (v * 100.0).round() / 100.0;
    (
        Some(round(sum / prices.len() as f64)),
        Some(round(prices.iter().cloned().fold(f64::INFINITY, f64::min))),
        Some(round(
            prices.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
        )),
    )
}

/// 一次回报里最终认定了什么
#[derive(Debug, Clone)]
pub(crate) struct Resolution {
    pub prices: Vec<f64>,
    pub avg: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub from_dom: bool,
    pub blocked: bool,
    /// 够不够格当「均价」记进趋势
    pub usable: bool,
}

/// 只从成功的搜索结果响应和已按关键词过滤的商品卡片取价。
/// 若接口明确带了空 `resultList`，则不采页面价格，以免把推荐商品当成搜索结果。
pub(crate) fn resolve(
    dom_prices: Vec<f64>,
    raw: &str,
    ret: &str,
    keyword: &str,
    page_verified: bool,
) -> Resolution {
    let success = ret.starts_with("SUCCESS::");
    let blocked = !ret.is_empty() && !success;
    let json = serde_json::from_str::<serde_json::Value>(raw).ok();
    let explicit_empty = json
        .as_ref()
        .and_then(|v| v.pointer("/data/resultList"))
        .and_then(serde_json::Value::as_array)
        .is_some_and(Vec::is_empty);
    let api_prices = if success {
        extract_matching_prices(raw, keyword)
    } else {
        Vec::new()
    };
    // 页面卡片已经按关键词和标题过滤；优先于可能含推荐/配件的结构化结果。
    let use_dom = page_verified && !blocked && !explicit_empty && dom_prices.len() >= 3;
    let prices = if use_dom { dom_prices } else { api_prices };
    let (avg, min, max) = summarize(&prices);
    let usable = (success || use_dom) && prices.len() >= 3 && avg.is_some();
    Resolution {
        prices,
        avg,
        min,
        max,
        from_dom: use_dom,
        blocked,
        usable,
    }
}

/// 把结论说成人话
pub(crate) fn message_for(r: &Resolution, stored: bool) -> String {
    let count = r.prices.len();
    let from = if r.from_dom {
        "页面上渲染的价格"
    } else {
        "接口响应"
    };
    if r.usable && stored {
        format!(
            "闲鱼{from}认出 {count} 条在售价，均价 ¥{}（{} ~ {}），已记入趋势",
            r.avg.unwrap_or_default(),
            r.min.unwrap_or_default(),
            r.max.unwrap_or_default()
        )
    } else if r.blocked {
        "闲鱼未返回有效的搜索结果，本次未更新价格。".to_string()
    } else if r.usable {
        "认出的均价没能写进存储，行情可能没记上。".to_string()
    } else if count > 0 {
        format!("只认出 {count} 个价格，太少不敢当均价（至少要 3 个）。")
    } else {
        format!("{from}里一个价格都没认出。")
    }
}

/// 去闲鱼搜一次价。
///
/// **必须是 `async`**：Tauri 文档在 `WebviewWindowBuilder::new` 上写明
/// 「On Windows, this function deadlocks when used in a synchronous command...」
/// （同 `commands/reader.rs`，症状是窗口建出来但不渲染）。
#[tauri::command]
pub async fn xianyu_fetch(
    app: AppHandle,
    wait: Arc<XianyuWait>,
    state: tauri::State<'_, crate::AppState>,
    target_id: String,
    keyword: String,
) -> Result<FetchSummary, String> {
    let keyword = keyword.trim();
    if keyword.is_empty() {
        return Err("搜索词不能为空".to_string());
    }
    let request_id = uuid::Uuid::new_v4().to_string();
    let url = format!("{}&_ge_probe={request_id}", search_url(keyword));
    let _fetch_guard = wait.fetch_lock.lock().await;
    wait.begin();

    if let Some(w) = app.get_webview_window(LABEL) {
        wait.note("复用已有抓价窗，跳去新关键词".into());
        w.navigate(reqwest::Url::parse(&url).map_err(|e| format!("关键词格式不对：{e}"))?)
            .map_err(|e| format!("切换搜索失败：{e}"))?;
    } else {
        wait.note(format!("新建抓价窗 → {url}"));
        let w2 = wait.clone();
        let window = WebviewWindowBuilder::new(
            &app,
            LABEL,
            WebviewUrl::External(
                reqwest::Url::parse(&url).map_err(|e| format!("关键词格式不对：{e}"))?,
            ),
        )
        .title("闲鱼查价")
        .inner_size(900.0, 700.0)
        .visible(false)
        .initialization_script(HOOK_JS)
        .on_page_load(move |_w, payload| {
            let line = format!("页面 {:?} {}", payload.event(), payload.url());
            eprintln!("[xianyu] {line}");
            w2.note(line);
        })
        .build()
        .map_err(|e| format!("建抓价窗口失败：{e}"))?;
        retain_session_on_close(&window);
    }

    let Some(w) = app.get_webview_window(LABEL) else {
        return Err("抓价窗口没能建立".to_string());
    };

    // 每次读取都验证搜索词，导航完成前不得接收上一件商品的价格。
    let deadline = tokio::time::Instant::now() + TIMEOUT;
    let mut last: Option<Poll> = None;
    let mut last_error = String::new();
    loop {
        match read_poll(&w, keyword).await {
            Ok(p) if is_search_page(&p.page_url, keyword, &request_id) => {
                let r = resolve(p.prices.clone(), &p.raw, &p.raw_ret, keyword, true);
                let finished = r.usable || needs_verification(&p.raw_ret);
                last = Some(p);
                if finished {
                    break;
                }
            }
            Ok(_) => {}
            Err(e) => last_error = e,
        }
        if tokio::time::Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(POLL_EVERY).await;
    }

    let Some(poll) = last else {
        return Ok(FetchSummary {
            ok: false,
            needs_verification: false,
            count: 0,
            avg: None,
            min: None,
            max: None,
            ret: String::new(),
            message: format!(
                "闲鱼搜索页未能就绪，请检查网络后重试。{last_error}\n{}",
                wait.logs()
            ),
        });
    };
    if !poll.raw.is_empty() {
        let raw: String = poll.raw.chars().take(RAW_KEEP).collect();
        let _ = state.storage.dump_xianyu_response(&raw);
    }
    let r = resolve(poll.prices.clone(), &poll.raw, &poll.raw_ret, keyword, true);
    let count = r.prices.len();
    let mut stored = None;
    if r.usable {
        stored = state
            .storage
            .add_price_sample(
                &target_id,
                r.avg.unwrap_or_default(),
                "xianyu",
                count as u32,
            )
            .ok();
    }
    let mut message = message_for(&r, stored.is_some());
    let verification = needs_verification(&poll.raw_ret);
    if verification {
        message = "闲鱼本次未提供可用的公开搜索结果，未更新价格。可改用免登录的公开二手报价查询。"
            .to_string();
    }
    if !r.usable {
        message.push_str(&format!(
            "\n页面：{}；搜索响应 {} 字节；采集脚本{}；页面价格 {} 条（未作为搜索结果计价）",
            poll.page_title,
            poll.raw.len(),
            if poll.hooked {
                "已就绪"
            } else {
                "未就绪"
            },
            poll.prices.len()
        ));
    }

    let summary = FetchSummary {
        ok: r.usable && stored.is_some(),
        needs_verification: verification,
        count,
        avg: r.avg,
        min: r.min,
        max: r.max,
        ret: poll.raw_ret,
        message,
    };
    Ok(summary)
}

/// 把那扇隐藏窗口显示出来。闲鱼哪天真要登录时用得上，
/// 登录态会留在 App 自己的 WebView2 目录里，下次直接复用。
#[tauri::command]
pub async fn xianyu_show(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.set_position(tauri::PhysicalPosition::new(80.0, 80.0));
        w.show().map_err(|e| format!("显示闲鱼窗口失败：{e}"))?;
        w.set_focus()
            .map_err(|e| format!("聚焦闲鱼窗口失败：{e}"))?;
        return Ok(());
    }
    // 还没建过就先建一扇可见的空窗口，让用户能进去登录
    let window = WebviewWindowBuilder::new(
        &app,
        LABEL,
        WebviewUrl::External(
            reqwest::Url::parse("https://www.goofish.com/").map_err(|e| e.to_string())?,
        ),
    )
    .title("闲鱼登录")
    .inner_size(1000.0, 760.0)
    .initialization_script(HOOK_JS)
    .build()
    .map_err(|e| format!("打开闲鱼失败：{e}"))?;
    retain_session_on_close(&window);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_chinese_keywords_per_byte() {
        // 编码错了闲鱼会回空结果页，看起来就像「没人卖这个牌子」
        assert_eq!(
            search_url("iPhone"),
            "https://www.goofish.com/search?q=iPhone"
        );
        assert_eq!(
            search_url("  机械键盘 "),
            "https://www.goofish.com/search?q=%E6%9C%BA%E6%A2%B0%E9%94%AE%E7%9B%98"
        );
    }

    #[test]
    fn accepts_only_the_requested_search_page() {
        assert!(is_search_page(
            &format!("{}&_ge_probe=new", search_url("机械键盘")),
            "机械键盘",
            "new"
        ));
        assert!(!is_search_page(
            &format!("{}&_ge_probe=old", search_url("机械键盘")),
            "机械键盘",
            "new"
        ));
        assert!(!is_search_page(&search_url("旧关键词"), "新关键词", "new"));
        assert!(!is_search_page(
            "https://other.example/search?q=x&_ge_probe=new",
            "x",
            "new"
        ));
    }

    #[test]
    fn native_callback_preserves_unicode_and_raw_response() {
        let p: Poll = serde_json::from_str(
            r#"{"raw":"{\"price\":100}","raw_ret":"SUCCESS::调用成功","page_title":"闲鱼 | 搜索"}"#,
        )
        .unwrap();
        assert_eq!(p.raw_ret, "SUCCESS::调用成功");
        assert_eq!(p.page_title, "闲鱼 | 搜索");
        assert_eq!(p.raw, r#"{"price":100}"#);
    }

    #[test]
    fn pulls_prices_out_of_a_nested_response() {
        // 结构是照 mtop 的常见形状手搓的，**不是实抓样本**：
        // 这条链路的响应体还没拿到过（见 extract_prices 的注释）。
        // 一旦真跑通，要用真实原文替换这个常量。
        let raw = r#"{"data":{"itemsArray":[
            {"itemId":"1","priceInfo":{"priceList":[{"price":"1317.94"},{"price":"1350.00"}]}},
            {"itemId":"2","priceInfo":{"priceList":[{"price":4750}]}}
        ]}}"#;
        let prices = extract_prices(raw);
        assert_eq!(prices.len(), 3);
        let (avg, min, max) = summarize(&prices);
        assert_eq!(avg, Some(2472.65));
        assert_eq!(min, Some(1317.94));
        assert_eq!(max, Some(4750.0));
    }

    #[test]
    fn ignores_prices_that_would_skew_the_average() {
        // 原价/折扣价/运费不能混进来，否则均价系统性偏高
        let raw = r#"{"price":"100","originPrice":"9999","discountPrice":"8888","shippingPrice":"12","price2":0}"#;
        let prices = extract_prices(raw);
        assert_eq!(prices, vec![100.0]);
    }

    #[test]
    fn rejects_responses_that_are_not_json_at_all() {
        assert!(extract_prices("<html>被风控了</html>").is_empty());
        assert!(extract_prices("").is_empty());
        let (avg, min, max) = summarize(&[]);
        assert_eq!((avg, min, max), (None, None, None));
    }

    #[test]
    fn recommendations_cannot_be_saved_as_search_prices() {
        for ret in ["", "RGV587_ERROR::SM::被拦截"] {
            let r = resolve(vec![6.5, 100.0, 1000.0], "", ret, "pocket 3", false);
            assert!(!r.usable);
            assert!(r.prices.is_empty());
            assert_eq!(r.avg, None);
        }
    }

    #[test]
    fn an_xhr_response_with_a_failed_ret_is_reported_as_blocked() {
        let raw = r#"{"ret":["RGV587_ERROR::SM::哎哟喂,被挤爆啦"]}"#;
        let r = resolve(
            vec![],
            raw,
            "RGV587_ERROR::SM::哎哟喂,被挤爆啦",
            "pocket 3",
            false,
        );
        assert!(r.blocked);
        assert!(!r.usable);
        assert!(message_for(&r, false).contains("本次未更新"));
    }

    #[test]
    fn verification_response_cannot_save_rendered_recommendations() {
        let ret = "RGV587_ERROR::SM::哎哟喂,被挤爆啦,请稍后重试!";
        assert!(needs_verification(ret));
        assert!(!needs_verification("FAIL_SYS_TOKEN_EXPIRED::令牌过期"));
        assert!(!needs_verification("SUCCESS::调用成功"));
        let r = resolve(vec![1800.0, 2000.0, 2100.0], "", ret, "pocket 3", true);
        assert!(r.blocked);
        assert!(!r.usable);
        assert_eq!(r.avg, None);
    }

    #[test]
    fn a_single_price_is_not_enough_for_an_average() {
        // 只认出 1 个就敢报均价的话，用户会拿它当行情用
        let r = resolve(
            vec![],
            r#"{"data":{"resultList":[{"title":"DJI Pocket 3","price":"1999"}]}}"#,
            "SUCCESS::调用成功",
            "pocket 3",
            false,
        );
        assert!(!r.usable);
        assert_eq!(r.avg, Some(1999.0), "算术上没错，但样本太少");
        assert!(message_for(&r, false).contains("太少"));
    }

    #[test]
    fn full_response_is_used_when_dom_has_too_few_prices() {
        let raw = r#"{"data":{"resultList":[{"title":"DJI Pocket 3","price":100},{"title":"DJI Pocket 3 相机","price":200},{"title":"Pocket 3 Creator Combo","price":300}]}}"#;
        let r = resolve(vec![999.0], raw, "SUCCESS::调用成功", "pocket 3", false);
        assert!(r.usable);
        assert!(!r.from_dom);
        assert_eq!(r.avg, Some(200.0));
        let denied = resolve(vec![], raw, "FAIL::not SUCCESS", "pocket 3", false);
        assert!(!denied.usable);
        assert!(denied.blocked);
        assert!(!resolve(vec![], "", "", "pocket 3", false).blocked);
    }

    #[test]
    fn only_search_results_are_averaged_and_currency_is_parsed() {
        let raw = r#"{"ret":["SUCCESS::调用成功"],"data":{"resultList":[
          {"title":"DJI Pocket 3 二手","data":{"item":{"main":{"exContent":{"price":"¥1,200.50"}}}}},
          {"title":"pocket 3 个人转让","price":"￥ 1,300"},{"title":"DJI Pocket 3 套装","price":1400}],"recommendations":[{"price":9}]}}"#;
        let r = resolve(vec![], raw, "SUCCESS::调用成功", "pocket 3", false);
        assert!(r.usable);
        assert_eq!(r.prices, vec![1200.5, 1300.0, 1400.0]);
        assert_eq!(r.avg, Some(1300.17));
        let empty =
            r#"{"data":{"resultList":[],"recommendations":[{"price":9},{"price":9},{"price":9}]}}"#;
        assert!(!resolve(vec![9.0; 3], empty, "SUCCESS::调用成功", "pocket 3", true).usable);
    }

    #[test]
    fn the_scrape_log_is_capped_so_the_head_survives() {
        // 超时时这段会原样贴到界面上。刷太多行没人看得下去，
        // 而且前面那几条（建窗、导航）恰恰是最关键的。
        let w = XianyuWait::default();
        w.begin();
        assert!(w.logs().contains("一条流水都没有"));
        for i in 0..40 {
            w.note(format!("第 {i} 行"));
        }
        let logs = w.logs();
        let lines: Vec<&str> = logs.lines().collect();
        assert_eq!(lines.len(), 30, "超出上限就该丢旧的");
        assert_eq!(lines[0], "第 10 行", "丢的是最前面的，不是最后面的");
        assert_eq!(lines[29], "第 39 行");
        // 新的一次抓价要清干净，别把上一次的流水带过来
        w.begin();
        assert!(w.logs().contains("一条流水都没有"));
    }
}
