//! 房价数据按来源、房屋类型和价格口径隔离，禁止将搜索摘要拼成价格曲线。
use chrono::{Datelike, Local, NaiveDate, Utc};
use dom_query::Document;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::Path,
    time::Duration,
};
use tokio::task::JoinSet;

static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .user_agent(crate::trending::http::UA)
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(9))
        .redirect(reqwest::redirect::Policy::limited(4))
        .build()
        .unwrap()
});

#[derive(Clone, Serialize, Deserialize)]
pub struct City {
    pub id: String,
    pub name: String,
}
pub fn cities() -> Vec<City> {
    "beijing:北京,shanghai:上海,guangzhou:广州,shenzhen:深圳,hangzhou:杭州,nanjing:南京,suzhou:苏州,chengdu:成都,chongqing:重庆,wuhan:武汉,xian:西安,tianjin:天津,zhengzhou:郑州,changsha:长沙,hefei:合肥,jinan:济南,qingdao:青岛,ningbo:宁波,xiamen:厦门,fuzhou:福州,wuxi:无锡,changzhou:常州,nanchang:南昌,kunming:昆明,guiyang:贵阳,nanning:南宁,haikou:海口,sanya:三亚,shijiazhuang:石家庄,taiyuan:太原,shenyang:沈阳,dalian:大连,changchun:长春,haerbin:哈尔滨,huhehaote:呼和浩特,lanzhou:兰州,xining:西宁,yinchuan:银川,wulumuqi:乌鲁木齐,tangshan:唐山,qinhuangdao:秦皇岛,baotou:包头,dandong:丹东,jinzhou:锦州,jilin:吉林,mudanjiang:牡丹江,xuzhou:徐州,yangzhou:扬州,wenzhou:温州,jinhua:金华,bengbu:蚌埠,anqing:安庆,quanzhou:泉州,jiujiang:九江,ganzhou:赣州,yantai:烟台,jining:济宁,luoyang:洛阳,pingdingshan:平顶山,yichang:宜昌,xiangyang:襄阳,yueyang:岳阳,changde:常德,shaoguan:韶关,zhanjiang:湛江,huizhou:惠州,guilin:桂林,beihai:北海,luzhou:泸州,nanchong:南充,zunyi:遵义,dali:大理,foshan:佛山,dongguan:东莞,zhuhai:珠海,zhongshan:中山"
        .split(',').map(|p| { let (id,name)=p.split_once(':').unwrap(); City{id:id.into(),name:name.into()} }).collect()
}
fn city(id: &str) -> Result<City, String> {
    cities()
        .into_iter()
        .find(|c| c.id == id)
        .ok_or("不支持的城市".into())
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub city: String,
    pub kind: String,
    pub community: Option<Community>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Community {
    pub id: String,
    pub name: String,
}
fn valid_community(id: &str) -> bool {
    id.strip_prefix("xq")
        .is_some_and(|s| !s.is_empty() && s.len() < 20 && s.bytes().all(|c| c.is_ascii_digit()))
}
fn valid_scope(id: &str) -> bool {
    valid_community(id)
        || id
            .strip_prefix("local-")
            .is_some_and(|s| uuid::Uuid::parse_str(s).is_ok())
}
fn community_name(raw: &str, city: &City) -> String {
    let mut name = raw.split("房价").next().unwrap_or(raw).trim().to_string();
    if let Some((prefix, rest)) = name.split_once('年') {
        if prefix.len() == 4
            && prefix
                .parse::<i32>()
                .is_ok_and(|y| (2000..=2200).contains(&y))
        {
            name = rest.to_string();
        }
    }
    if name.len() >= 4
        && name.is_char_boundary(4)
        && name[..4]
            .parse::<i32>()
            .is_ok_and(|y| (2000..=2200).contains(&y))
        && name[4..].starts_with(&city.name)
    {
        name = name[4..].to_string();
    }
    name.strip_prefix(&city.name)
        .unwrap_or(&name)
        .trim_end_matches("历史")
        .trim()
        .to_string()
}
fn validate(q: &Query) -> Result<City, String> {
    let city = city(&q.city)?;
    if !["all", "new", "second"].contains(&q.kind.as_str()) {
        return Err("无效的房屋类型".into());
    }
    if q.community.as_ref().is_some_and(|c| {
        !valid_scope(&c.id) || c.name.trim().is_empty() || c.name.chars().count() > 200
    }) {
        return Err("无效的小区".into());
    }
    Ok(city)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub month: String,
    pub value: f64,
    pub mom: Option<f64>,
    pub yoy: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_month: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub basis: String,
    pub unit: String,
    pub source_url: String,
    pub points: Vec<Point>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub name: String,
    pub url: String,
    pub status: String,
    pub message: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Link {
    pub title: String,
    pub url: String,
    pub snippet: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub query: Query,
    pub city_name: String,
    pub fetched_at: String,
    pub series: Vec<Series>,
    pub sources: Vec<Source>,
    pub communities: Vec<Community>,
    pub links: Vec<Link>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Watch {
    pub id: String,
    pub query: Query,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub id: String,
    pub city: String,
    pub community_id: Option<String>,
    #[serde(default)]
    pub community_name: Option<String>,
    pub kind: String,
    pub basis: String,
    pub month: String,
    pub price: f64,
    pub source_url: String,
}
#[derive(Default, Serialize, Deserialize)]
pub struct Saved {
    pub watches: Vec<Watch>,
    pub observations: Vec<Observation>,
}
fn saved(root: &Path) -> Result<Saved, String> {
    let p = root.join("housing.json");
    if !p.exists() {
        return Ok(Saved::default());
    }
    serde_json::from_slice(&fs::read(p).map_err(|e| e.to_string())?)
        .map_err(|e| format!("房价记录读取失败：{e}"))
}
fn write<T: Serialize>(p: &Path, value: &T) -> Result<(), String> {
    fs::create_dir_all(p.parent().ok_or("无效存储路径")?).map_err(|e| e.to_string())?;
    crate::db::vault::write_json(p, value).map_err(|e| e.to_string())
}
pub async fn bootstrap(root: &Path) -> Result<(Vec<City>, Saved), String> {
    let _g = LOCK.lock().await;
    Ok((cities(), saved(root)?))
}
pub async fn watch(root: &Path, q: Query) -> Result<Vec<Watch>, String> {
    validate(&q)?;
    let _g = LOCK.lock().await;
    let mut s = saved(root)?;
    if !s.watches.iter().any(|w| {
        w.query.city == q.city
            && w.query.kind == q.kind
            && w.query.community.as_ref().map(|c| &c.id) == q.community.as_ref().map(|c| &c.id)
    }) {
        if s.watches.len() >= 100 {
            return Err("最多保存100个追踪对象".into());
        }
        s.watches.push(Watch {
            id: uuid::Uuid::new_v4().to_string(),
            query: q,
        });
        write(&root.join("housing.json"), &s)?;
    }
    Ok(s.watches)
}
pub async fn remove(root: &Path, id: &str, observation: bool) -> Result<Saved, String> {
    let _g = LOCK.lock().await;
    let mut s = saved(root)?;
    if observation {
        s.observations.retain(|o| o.id != id);
    } else {
        s.watches.retain(|w| w.id != id);
    }
    write(&root.join("housing.json"), &s)?;
    Ok(s)
}
pub async fn observe(root: &Path, q: Query, mut o: Observation) -> Result<Saved, String> {
    validate(&q)?;
    let day = NaiveDate::parse_from_str(&format!("{}-01", o.month), "%Y-%m-%d")
        .map_err(|_| "月份应为 YYYY-MM")?;
    if day > Local::now().date_naive()
        || day.year() < 2000
        || !o.price.is_finite()
        || !(100.0..=1_000_000.0).contains(&o.price)
        || !["new", "second"].contains(&o.kind.as_str())
        || !["挂牌参考", "成交记录", "开发商报价"].contains(&o.basis.as_str())
        || (!o.source_url.is_empty() && !safe_url(&o.source_url))
        || o.source_url.len() > 2000
    {
        return Err("请检查日期、单价（100～1,000,000元/㎡）和来源网址".into());
    }
    let _g = LOCK.lock().await;
    let mut s = saved(root)?;
    o.month = day.format("%Y-%m").to_string();
    o.city = q.city;
    o.community_name = q.community.as_ref().map(|c| c.name.clone());
    o.community_id = q.community.map(|c| c.id);
    o.id = uuid::Uuid::new_v4().to_string();
    if s.observations.len() >= 10000 {
        return Err("手动记录已达到10000条上限".into());
    }
    if s.observations.iter().any(|v| {
        v.city == o.city
            && v.community_id == o.community_id
            && v.kind == o.kind
            && v.basis == o.basis
            && v.source_url == o.source_url
            && v.month == o.month
    }) {
        return Err("该月份已有相同来源和口径的记录，请先移除旧记录".into());
    }
    s.observations.push(o);
    write(&root.join("housing.json"), &s)?;
    Ok(s)
}

fn text(raw: &str) -> String {
    raw.split_whitespace().collect::<String>()
}
fn number(raw: &str) -> Option<f64> {
    let s: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
        .collect();
    s.parse::<f64>().ok().filter(|v| v.is_finite())
}
fn month(raw: &str) -> Option<String> {
    let s = text(raw);
    let (y, m) = s.split_once('年')?;
    let m = m.split('月').next()?.parse::<u32>().ok()?;
    let y = y.parse::<i32>().ok()?;
    NaiveDate::from_ymd_opt(y, m, 1)?;
    Some(format!("{y:04}-{m:02}"))
}
fn safe_url(raw: &str) -> bool {
    reqwest::Url::parse(raw).is_ok_and(|u| {
        matches!(u.scheme(), "https" | "http")
            && u.host_str().is_some()
            && u.username().is_empty()
            && u.password().is_none()
    })
}
fn adjacent(a: &str, b: &str) -> bool {
    let parse = |s: &str| {
        NaiveDate::parse_from_str(&format!("{s}-01"), "%Y-%m-%d")
            .ok()
            .map(|d| d.year() * 12 + d.month() as i32)
    };
    matches!((parse(a),parse(b)),(Some(a),Some(b)) if b-a==1)
}
async fn fetch(url: &str) -> Result<String, String> {
    let mut r = CLIENT
        .get(url)
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "请求超时".to_string()
            } else {
                "连接失败".to_string()
            }
        })?
        .error_for_status()
        .map_err(|e| format!("HTTP {}", e.status().map(|s| s.as_u16()).unwrap_or(0)))?;
    let mut bytes = Vec::new();
    while let Some(chunk) = r.chunk().await.map_err(|_| "响应读取失败")? {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err("页面超出4MB限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let html = String::from_utf8_lossy(&bytes).into_owned();
    if html.contains("callback.58.com/antibot/verifycode") || html.contains("@@xxzlGatewayUrl") {
        return Err("平台要求人工验证，请用内置网页核验后读取".into());
    }
    let title = Document::from(html.as_str())
        .select_single("title")
        .text()
        .to_string();
    if ["验证码", "安全验证", "访问验证"]
        .iter()
        .any(|s| title.contains(s))
    {
        return Err("来源要求人工验证，可打开原文查看".into());
    }
    Ok(html)
}

fn anjuke_url(city: &City, year: i32, community: Option<&Community>) -> String {
    format!(
        "https://www.anjuke.com/fangjia/{}{year}/{}",
        city.id,
        community.map(|c| format!("{}/", c.id)).unwrap_or_default()
    )
}
fn creprice_url(city: &City) -> Option<String> {
    let code = match city.id.as_str() {
        "beijing" => "bj",
        "shanghai" => "sh",
        "guangzhou" => "gz",
        "shenzhen" => "sz",
        "hangzhou" => "hz",
        "nanjing" => "nj",
        "chengdu" => "cd",
        "chongqing" => "cq",
        "wuhan" => "wh",
        "tianjin" => "tj",
        "xiamen" => "xm",
        "ningbo" => "nb",
        "qingdao" => "qd",
        "jinan" => "jn",
        "fuzhou" => "fz",
        "hefei" => "hf",
        "changsha" => "cs",
        "zhengzhou" => "zz",
        "xian" => "xa",
        _ => return None,
    };
    Some(format!("https://m.creprice.cn/city/{code}.html"))
}
fn parse_creprice(html: &str, city: &City) -> Result<Point, String> {
    let doc = Document::from(html);
    let data = doc.select_single(".cont_01 .data");
    if !data.select_single("h1").text().contains(&city.name) {
        return Err("挂牌页城市不匹配".into());
    }
    let timing = data.select_single(".cont_tim").text().to_string();
    if !timing.contains("挂牌") {
        return Err("未确认来源的挂牌口径".into());
    }
    let m =
        month(timing.trim_start_matches(|c: char| !c.is_ascii_digit())).ok_or("挂牌页缺少月份")?;
    let price = data.select_single(".fl").text();
    if !price.contains("元/㎡") {
        return Err("挂牌页未取得单价单位".into());
    }
    let value = number(&price)
        .filter(|v| (100.0..=1_000_000.0).contains(v))
        .ok_or("挂牌单价无效")?;
    if m > Local::now().format("%Y-%m").to_string() {
        return Err("不采用未来月份价格".into());
    }
    let rate = data.select_single(".fr").text();
    let mom = number(&rate)
        .map(|v| {
            if rate.contains('▼') || rate.contains('↓') {
                -v.abs()
            } else {
                v
            }
        })
        .filter(|v| (-50.0..=50.0).contains(v));
    Ok(Point {
        month: m,
        value,
        mom,
        yoy: None,
        anchor_month: None,
    })
}
fn parse_anjuke(
    html: &str,
    city: &City,
    year: i32,
    community: Option<&Community>,
) -> Result<(Vec<Point>, Vec<Community>), String> {
    let doc = Document::from(html);
    let heading = doc.select_single("h1").text().to_string();
    if !heading.contains(&city.name) && community.is_none() {
        return Err("页面城市不匹配，未采用数据".into());
    }
    if !heading.contains(&year.to_string()) || !heading.contains("房价") {
        return Err("页面缺少可验证的年份与房价标题".into());
    }
    if community.is_some_and(|c| !heading.contains(&c.name)) {
        return Err("页面小区名称与选择不匹配，未采用数据".into());
    }
    let mut points = BTreeMap::new();
    for row in doc.select(".list-table .table-tr").iter() {
        let cols: Vec<_> = row
            .select(".td")
            .iter()
            .map(|c| c.text().to_string())
            .collect();
        if cols.len() < 2 {
            continue;
        }
        let Some(m) = month(&cols[0]) else {
            continue;
        };
        if !m.starts_with(&format!("{year}-")) || !cols[1].contains("元/") {
            continue;
        }
        let Some(v) = number(&cols[1]) else {
            continue;
        };
        if !(100.0..=1_000_000.0).contains(&v) {
            continue;
        }
        points.insert(
            m.clone(),
            Point {
                month: m,
                value: v,
                mom: None,
                yoy: None,
                anchor_month: None,
            },
        );
    }
    if points.is_empty() {
        return Err("未找到结构化月度单价，未从搜索摘要猜测价格".into());
    }
    let mut communities = Vec::new();
    let mut seen = HashSet::new();
    for a in doc.select("a[href]").iter() {
        let Some(href) = a.attr("href") else {
            continue;
        };
        let Some(id) = href.split('/').find(|s| valid_community(s)) else {
            continue;
        };
        if !href.contains(&format!("/fangjia/{}", city.id)) || !seen.insert(id.to_string()) {
            continue;
        }
        let name = a.text().split_whitespace().collect::<String>();
        let name = name
            .trim_start_matches(&format!("{year}年"))
            .split("房价")
            .next()
            .unwrap_or("")
            .to_string();
        if !name.is_empty() {
            communities.push(Community {
                id: id.into(),
                name,
            });
        }
    }
    Ok((points.into_values().collect(), communities))
}

#[derive(Clone, Serialize, Deserialize)]
struct OfficialRow {
    city: String,
    kind: String,
    month: String,
    mom: f64,
    yoy: f64,
    url: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfficialCache {
    fetched_at: String,
    rows: Vec<OfficialRow>,
}
fn parse_official(html: &str, url: &str) -> Result<Vec<OfficialRow>, String> {
    let doc = Document::from(html);
    let title = text(&doc.select_single("title").text());
    let m = month(&title).ok_or("官方报告标题缺少月份")?;
    if !title.contains("70个大中城市") || !title.contains("销售价格") {
        return Err("并非官方70城住宅价格报告".into());
    }
    let known: HashSet<_> = cities().into_iter().map(|c| c.name).collect();
    let mut rows = Vec::new();
    for (index, table) in doc.select("table").iter().take(2).enumerate() {
        let contents = text(&table.text());
        if !contents.contains("环比") || !contents.contains("同比") {
            return Err("官方表头发生变化，已停止解析".into());
        }
        for tr in table.select("tr").iter() {
            let cells: Vec<_> = tr.select("td").iter().map(|c| text(&c.text())).collect();
            for i in 0..cells.len() {
                if !known.contains(&cells[i]) || i + 2 >= cells.len() {
                    continue;
                }
                let (Some(mom), Some(yoy)) = (number(&cells[i + 1]), number(&cells[i + 2])) else {
                    continue;
                };
                if !(70.0..=130.0).contains(&mom) || !(30.0..=200.0).contains(&yoy) {
                    continue;
                }
                rows.push(OfficialRow {
                    city: cells[i].clone(),
                    kind: if index == 0 { "new" } else { "second" }.into(),
                    month: m.clone(),
                    mom: mom - 100.0,
                    yoy: yoy - 100.0,
                    url: url.into(),
                });
            }
        }
    }
    if rows.len() < 100 {
        return Err("官方70城表格不完整，未采用该报告".into());
    }
    Ok(rows)
}
async fn official(root: &Path, force: bool) -> (Vec<OfficialRow>, Source) {
    let path = root.join("official.json");
    let cached = fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<OfficialCache>(&b).ok());
    let base = "https://www.stats.gov.cn/sj/zxfb/";
    if !force {
        if let Some(c) = &cached {
            if chrono::DateTime::parse_from_rfc3339(&c.fetched_at)
                .is_ok_and(|d| Utc::now().signed_duration_since(d).num_hours() < 12)
            {
                return (
                    c.rows.clone(),
                    Source {
                        name: "国家统计局".into(),
                        url: base.into(),
                        status: "cached".into(),
                        message: format!("12小时内缓存，检索于 {}", c.fetched_at),
                    },
                );
            }
        }
    }
    let result = tokio::time::timeout(Duration::from_secs(28), async {
        let mut links = BTreeMap::new();
        let mut failures = 0;
        // 两批并发拉取最近12个列表页，从官方标题发现历史报告地址，不写死文章ID。
        for batch in 0..2 {
            let mut tasks = JoinSet::new();
            for page in batch * 6..batch * 6 + 6 {
                tasks.spawn(async move {
                    let url = if page == 0 {
                        base.to_string()
                    } else {
                        format!("{base}index_{page}.html")
                    };
                    fetch(&url).await
                });
            }
            while let Some(r) = tasks.join_next().await {
                if let Ok(Ok(html)) = r {
                    let doc = Document::from(html.as_str());
                    for a in doc.select("a[href]").iter() {
                        let title = text(&a.text());
                        if title.contains("70个大中城市商品住宅销售价格变动情况") {
                            if let (Some(m), Some(href)) = (month(&title), a.attr("href")) {
                                if let Ok(u) = reqwest::Url::parse(base).unwrap().join(&href) {
                                    if u.host_str() == Some("www.stats.gov.cn") {
                                        links.insert(m, u.to_string());
                                    }
                                }
                            }
                        }
                    }
                } else {
                    failures += 1;
                }
            }
        }
        let mut rows = Vec::new();
        let articles: Vec<_> = links.into_iter().rev().take(12).map(|(_, u)| u).collect();
        for batch in articles.chunks(4) {
            let mut tasks = JoinSet::new();
            for url in batch {
                let url = url.clone();
                tasks.spawn(async move {
                    let html = fetch(&url).await?;
                    parse_official(&html, &url)
                });
            }
            while let Some(r) = tasks.join_next().await {
                if let Ok(Ok(mut data)) = r {
                    rows.append(&mut data);
                } else {
                    failures += 1;
                }
            }
        }
        (rows, failures)
    })
    .await;
    let (mut rows, failures) = result.unwrap_or_default();
    let count = rows
        .iter()
        .map(|r| r.month.clone())
        .collect::<HashSet<_>>()
        .len();
    if rows.is_empty() {
        if let Some(c) = cached {
            return (
                c.rows,
                Source {
                    name: "国家统计局".into(),
                    url: base.into(),
                    status: "cached".into(),
                    message: format!("联网更新失败，保留 {} 的历史缓存", c.fetched_at),
                },
            );
        }
    }
    if let Some(c) = &cached {
        for row in &c.rows {
            if !rows
                .iter()
                .any(|r| r.city == row.city && r.kind == row.kind && r.month == row.month)
            {
                rows.push(row.clone());
            }
        }
    }
    let mut message =
        format!("成功读取 {count} 个发布月份；{failures} 个页面未获取。指数不等于元/㎡成交均价。");
    if !rows.is_empty() {
        if let Err(e) = write(
            &path,
            &OfficialCache {
                fetched_at: Utc::now().to_rfc3339(),
                rows: rows.clone(),
            },
        ) {
            message.push_str(&format!(" 缓存未保存：{e}"));
        }
    }
    (
        rows,
        Source {
            name: "国家统计局".into(),
            url: base.into(),
            status: if count > 0 { "live" } else { "failed" }.into(),
            message,
        },
    )
}

fn official_series(rows: &[OfficialRow], city: &City, kind: &str) -> Option<Series> {
    let mut selected: Vec<_> = rows
        .iter()
        .filter(|r| r.city == city.name && r.kind == kind)
        .collect();
    selected.sort_by(|a, b| a.month.cmp(&b.month));
    let mut points: Vec<Point> = Vec::new();
    let mut value = 100.0;
    let mut anchor = String::new();
    for r in &selected {
        if points.is_empty() {
            anchor = r.month.clone();
        }
        if let Some(p) = points.last() {
            if !adjacent(&p.month, &r.month) {
                anchor = r.month.clone();
                value = 100.0;
            } else {
                value *= 1.0 + r.mom / 100.0;
            }
        }
        points.push(Point {
            month: r.month.clone(),
            value,
            mom: Some(r.mom),
            yoy: Some(r.yoy),
            anchor_month: Some(anchor.clone()),
        });
    }
    Some(Series {
        id: format!("nbs-{kind}"),
        name: format!(
            "官方{}价格指数",
            if kind == "new" { "新房" } else { "二手房" }
        ),
        kind: kind.into(),
        basis: "官方销售价格指数".into(),
        unit: "指数（连续区间首期=100）".into(),
        source_url: selected.last()?.url.clone(),
        points,
    })
}
async fn research(
    city: &City,
    community: Option<&Community>,
) -> Result<(Vec<Link>, Vec<Community>), String> {
    let query = format!(
        "{} {} 房价 小区 新房 二手房",
        city.name,
        community.map(|c| c.name.as_str()).unwrap_or("")
    );
    search_links(&query, city).await
}
async fn search_links(query: &str, city: &City) -> Result<(Vec<Link>, Vec<Community>), String> {
    let mut url = reqwest::Url::parse("https://www.so.com/s").unwrap();
    url.query_pairs_mut().append_pair("q", query);
    let raw = fetch(&url.as_str().replace('+', "%20")).await?;
    let doc = Document::from(raw.as_str());
    let mut links = Vec::new();
    let mut communities = Vec::new();
    let mut seen = HashSet::new();
    for block in doc.select("li.res-list").iter() {
        let a = block.select_single("h3 a[href]");
        let Some(href) = a.attr("data-mdurl").or_else(|| a.attr("href")) else {
            continue;
        };
        if !safe_url(&href) || href.contains("ai.so.com/") || !seen.insert(href.to_string()) {
            continue;
        }
        let title = a.text().split_whitespace().collect::<Vec<_>>().join(" ");
        let snippet = block
            .select_single(".res-rich, .res-desc, [data-result-summary]")
            .text()
            .chars()
            .take(180)
            .collect::<String>();
        let combined = format!("{title}{snippet}");
        if !combined.contains(&city.name)
            || !["房价", "新房", "二手房", "楼盘", "住宅", "房产", "成交"]
                .iter()
                .any(|s| combined.contains(s))
        {
            continue;
        }
        if let Ok(u) = reqwest::Url::parse(&href) {
            if u.host_str()
                .is_some_and(|h| h == "anjuke.com" || h.ends_with(".anjuke.com"))
                && u.path().contains(&format!("/fangjia/{}", city.id))
            {
                if let Some(id) = u.path().split('/').find(|s| valid_community(s)) {
                    let name = community_name(&title, city);
                    communities.push(Community {
                        id: id.into(),
                        name,
                    });
                }
            }
        }
        links.push(Link {
            title,
            url: href.to_string(),
            snippet,
        });
        if links.len() == 8 {
            break;
        }
    }
    Ok((links, communities))
}
pub async fn communities(city_id: &str, keyword: &str) -> Result<Vec<Community>, String> {
    let city = city(city_id)?;
    let keyword = keyword.trim();
    if keyword.chars().count() < 2 || keyword.chars().count() > 60 {
        return Err("小区名称请输入2～60字".into());
    }
    let query = format!(
        "{} {} 房价 site:anjuke.com/fangjia/{}",
        city.name, keyword, city.id
    );
    let (_, list) = search_links(&query, &city).await?;
    if list.is_empty() {
        return Err("未找到可核验的小区历史页，可从城市页面的小区列表选择，或稍后重试".into());
    }
    Ok(list)
}

fn manual_series(s: &Saved, q: &Query) -> Vec<Series> {
    let mut output = Vec::new();
    let mut groups: BTreeMap<String, Series> = BTreeMap::new();
    for o in s.observations.iter().filter(|o| {
        o.city == q.city
            && o.community_id == q.community.as_ref().map(|c| c.id.clone())
            && (q.kind == "all" || q.kind == o.kind)
    }) {
        let id = format!("manual:{}:{}:{}", o.kind, o.basis, o.source_url);
        let group = groups.entry(id.clone()).or_insert(Series {
            id,
            name: format!("手动·{}", o.basis),
            kind: o.kind.clone(),
            basis: o.basis.clone(),
            unit: "元/㎡".into(),
            source_url: o.source_url.clone(),
            points: vec![],
        });
        group.points.push(Point {
            month: o.month.clone(),
            value: o.price,
            mom: None,
            yoy: None,
            anchor_month: None,
        });
    }
    for (_, mut s) in groups {
        s.points.sort_by(|a, b| a.month.cmp(&b.month));
        output.push(s);
    }
    output
}

pub async fn report(root: &Path, q: Query, force: bool) -> Result<Report, String> {
    let city = validate(&q)?;
    let _g = LOCK.lock().await;
    let now = Local::now();
    let prefix = format!(
        "{}-{}",
        city.id,
        q.community
            .as_ref()
            .map(|c| c.id.as_str())
            .unwrap_or("city")
    );
    let cache_path = root.join(format!("{prefix}-{}-platform.json", q.kind));
    let cached = fs::read(&cache_path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Report>(&b).ok());
    if !force {
        if let Some(c) = &cached {
            let has_remote = c.series.iter().any(|s| !s.id.starts_with("manual:"));
            let custom = q
                .community
                .as_ref()
                .is_some_and(|c| c.id.starts_with("local-"));
            let fresh = chrono::DateTime::parse_from_rfc3339(&c.fetched_at).is_ok_and(|d| {
                let age = Utc::now().signed_duration_since(d).num_seconds();
                age >= 0 && age < if has_remote || custom { 6 * 3600 } else { 30 }
            });
            if fresh && (!c.series.is_empty() || !c.links.is_empty()) {
                let mut report = c.clone();
                report.series.retain(|s| !s.id.starts_with("manual:"));
                report.series.extend(manual_series(&saved(root)?, &q));
                for source in &mut report.sources {
                    if source.status == "live" {
                        source.status = "cached".into();
                    }
                }
                return Ok(report);
            }
        }
    }
    let mut sources = Vec::new();
    let mut series = Vec::new();
    let mut choices = Vec::new();
    let (official_data, official_source) = if q.community.is_none() {
        let (r, s) = official(root, force).await;
        (r, Some(s))
    } else {
        (Vec::new(), None)
    };
    if let Some(mut s) = official_source {
        if !official_data.is_empty() && !official_data.iter().any(|r| r.city == city.name) {
            s.status = "unavailable".into();
            s.message = "该城市不在当前取得的官方70城指数中，未用其他城市指数替代。".into();
        }
        sources.push(s);
        for kind in ["new", "second"] {
            if q.kind == "all" || q.kind == kind {
                if let Some(s) = official_series(&official_data, &city, kind) {
                    series.push(s);
                }
            }
        }
    }
    if q.kind != "new"
        && q.community
            .as_ref()
            .map_or(true, |c| valid_community(&c.id))
    {
        let url = anjuke_url(&city, now.year(), q.community.as_ref());
        let mut tasks = JoinSet::new();
        for year in now.year() - 2..=now.year() {
            let city = city.clone();
            let c = q.community.clone();
            tasks.spawn(async move {
                let url = anjuke_url(&city, year, c.as_ref());
                let html = fetch(&url).await?;
                parse_anjuke(&html, &city, year, c.as_ref())
            });
        }
        let mut points = BTreeMap::new();
        let mut failures = 0;
        while let Some(r) = tasks.join_next().await {
            match r {
                Ok(Ok((p, c))) => {
                    for p in p {
                        if p.month <= now.format("%Y-%m").to_string() {
                            points.insert(p.month.clone(), p);
                        }
                    }
                    choices.extend(c);
                }
                _ => failures += 1,
            }
        }
        let live_count = points.len();
        let mut reused = 0;
        if let Some(c) = &cached {
            for series in c.series.iter().filter(|s| s.id == "anjuke-second") {
                for p in &series.points {
                    if !points.contains_key(&p.month) {
                        points.insert(p.month.clone(), p.clone());
                        reused += 1;
                    }
                }
            }
            if choices.is_empty() {
                choices.extend(c.communities.clone());
            }
        }
        let platform_status = if live_count == 0 && reused > 0 {
            "cached"
        } else {
            "live"
        };
        let message = if points.is_empty() {
            "未取得可验证的历史单价，可能需要人工验证；未使用城市价冒充小区价".into()
        } else {
            format!(
                "{}个月平台参考单价；{failures}个年份页面未获取，缓存补充{reused}个月。不是已核验成交均价。",
                points.len()
            )
        };
        sources.push(Source {
            name: "安居客历史房价".into(),
            url: url.clone(),
            status: if points.is_empty() {
                "failed"
            } else {
                platform_status
            }
            .into(),
            message,
        });
        if !points.is_empty() {
            series.push(Series {
                id: "anjuke-second".into(),
                name: "安居客二手房参考价".into(),
                kind: "second".into(),
                basis: "平台参考单价（非成交）".into(),
                unit: "元/㎡".into(),
                source_url: url,
                points: points.into_values().collect(),
            });
        }
    }
    if q.community.is_some() && q.kind == "new" {
        sources.push(Source {
            name: "小区新房口径".into(),
            url: "https://www.anjuke.com/".into(),
            status: "unavailable".into(),
            message: "小区历史页是二手房参考口径，未作为新房数据使用。可记录开发商报价，逐期追踪。"
                .into(),
        });
    }
    if q.community
        .as_ref()
        .is_some_and(|c| c.id.starts_with("local-"))
    {
        sources.push(Source {
            name: "自定义楼盘/小区".into(),
            url: "".into(),
            status: "unavailable".into(),
            message: "尚未绑定可核验的历史价格页；当前追踪资讯与手动记录，不使用全市价格代替。"
                .into(),
        });
    }
    // The provider does not separate new and resale; keep this series in the
    // all-residential scope and collect snapshots without inventing history.
    if q.kind == "all" && q.community.is_none() {
        if let Some(url) = creprice_url(&city) {
            let result = match fetch(&url).await {
                Ok(html) => parse_creprice(&html, &city),
                Err(e) => Err(e),
            };
            let mut points: BTreeMap<String, Point> = BTreeMap::new();
            if let Some(c) = &cached {
                if let Some(s) = c.series.iter().find(|s| s.id == "creprice-residential") {
                    for p in &s.points {
                        points.insert(p.month.clone(), p.clone());
                    }
                }
            }
            let (status, message) = match result {
                Ok(p) => {
                    points.insert(p.month.clone(), p);
                    ("live","住宅挂牌均价，来源未区分新房与二手房；本机逐月积累快照，首次只有一个月。不与官方指数或其他平台均价混算。".to_string())
                }
                Err(e) => (
                    if points.is_empty() {
                        "failed"
                    } else {
                        "cached"
                    },
                    format!("本次更新未成功：{e}；保留本机已收集的月份。"),
                ),
            };
            sources.push(Source {
                name: "中国房价行情·住宅挂牌".into(),
                url: url.clone(),
                status: status.into(),
                message,
            });
            if !points.is_empty() {
                series.push(Series {
                    id: "creprice-residential".into(),
                    name: "中国房价行情·住宅挂牌".into(),
                    kind: "all".into(),
                    basis: "住宅挂牌均价（未分新/二手）".into(),
                    unit: "元/㎡".into(),
                    source_url: url,
                    points: points.into_values().collect(),
                });
            }
        }
    }
    let (links, extra) = match research(&city, q.community.as_ref()).await {
        Ok((links, extra)) => (links, extra),
        Err(e) => {
            sources.push(Source {
                name: "房产资讯检索".into(),
                url: "https://www.so.com/".into(),
                status: "failed".into(),
                message: e,
            });
            (vec![], vec![])
        }
    };
    choices.extend(extra);
    let mut seen = HashSet::new();
    choices.retain(|c| seen.insert(c.id.clone()));
    choices.truncate(50);
    series.extend(manual_series(&saved(root)?, &q));
    let report = Report {
        query: q,
        city_name: city.name,
        fetched_at: Utc::now().to_rfc3339(),
        series,
        sources,
        communities: choices,
        links,
    };
    if let Err(e) = write(&cache_path, &report) {
        let mut report = report;
        report.sources.push(Source {
            name: "本地缓存".into(),
            url: "".into(),
            status: "failed".into(),
            message: format!("数据已获取，但缓存未保存：{e}"),
        });
        return Ok(report);
    }
    Ok(report)
}

fn check_source(q: &Query, year: i32) -> Result<(City, reqwest::Url), String> {
    let c = validate(q)?;
    if q.kind == "new"
        || q.community
            .as_ref()
            .is_some_and(|c| !valid_community(&c.id))
    {
        return Err("平台历史页仅支持可核验的二手房口径".into());
    }
    if !(2006..=Local::now().year()).contains(&year) {
        return Err("无效的历史年份".into());
    }
    let url = reqwest::Url::parse(&anjuke_url(&c, year, q.community.as_ref()))
        .map_err(|_| "无效的来源网址")?;
    Ok((c, url))
}
fn matches_source(actual: &reqwest::Url, expected: &reqwest::Url) -> bool {
    actual.scheme() == expected.scheme()
        && actual.host_str() == expected.host_str()
        && actual.port_or_known_default() == expected.port_or_known_default()
        && actual.path() == expected.path()
        && actual.username().is_empty()
        && actual.password().is_none()
}
pub fn source_open(app: &tauri::AppHandle, q: &Query, year: i32) -> Result<(), String> {
    use tauri::Manager;
    let (_, url) = check_source(q, year)?;
    if let Some(w) = app.get_webview_window("housing-source") {
        w.navigate(url).map_err(|e| e.to_string())?;
        w.show().map_err(|e| e.to_string())?;
        let _ = w.set_focus();
    } else {
        tauri::WebviewWindowBuilder::new(app, "housing-source", tauri::WebviewUrl::External(url))
            .title("房价来源核验 · 请自行完成必要验证后返回读取")
            .inner_size(1100.0, 800.0)
            .build()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub async fn source_read(
    app: &tauri::AppHandle,
    root: &Path,
    q: Query,
    year: i32,
) -> Result<Report, String> {
    use tauri::Manager;
    let (city, expected) = check_source(&q, year)?;
    let window = app
        .get_webview_window("housing-source")
        .ok_or("请先打开房价来源网页")?;
    if !matches_source(&window.url().map_err(|e| e.to_string())?, &expected) {
        return Err("内置网页还未进入当前房价历史页，请完成验证后再读取".into());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = parking_lot::Mutex::new(Some(tx));
    window.eval_with_callback("(() => ({url: location.href, html: document.documentElement.outerHTML.length <= 4000000 ? document.documentElement.outerHTML : ''}))()",move|raw|{if let Some(tx)=tx.lock().take(){let _=tx.send(raw);}}).map_err(|e|e.to_string())?;
    let raw = tokio::time::timeout(Duration::from_secs(4), rx)
        .await
        .map_err(|_| "读取网页超时")?
        .map_err(|e| e.to_string())?;
    #[derive(Deserialize)]
    struct Snapshot {
        url: String,
        html: String,
    }
    let page: Snapshot =
        serde_json::from_str(&raw).map_err(|_| "未取得网页内容，请等待页面加载后重试")?;
    let actual = reqwest::Url::parse(&page.url).map_err(|_| "无法核验网页地址")?;
    if !matches_source(&actual, &expected) || page.html.len() > 4 * 1024 * 1024 {
        return Err(
            "网页地址与当前城市、小区及年份不匹配。请完成验证并打开对应房价历史页后重试。".into(),
        );
    }
    let (points, communities) = parse_anjuke(&page.html, &city, year, q.community.as_ref())?;
    let _g = LOCK.lock().await;
    let prefix = format!(
        "{}-{}",
        city.id,
        q.community
            .as_ref()
            .map(|c| c.id.as_str())
            .unwrap_or("city")
    );
    let path = root.join(format!("{prefix}-{}-platform.json", q.kind));
    let mut report = fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Report>(&b).ok())
        .unwrap_or(Report {
            query: q.clone(),
            city_name: city.name,
            fetched_at: Utc::now().to_rfc3339(),
            series: vec![],
            sources: vec![],
            communities: vec![],
            links: vec![],
        });
    let mut merged = BTreeMap::new();
    if let Some(s) = report.series.iter().find(|s| s.id == "anjuke-second") {
        for p in &s.points {
            merged.insert(p.month.clone(), p.clone());
        }
    }
    for p in points {
        if p.month <= Local::now().format("%Y-%m").to_string() {
            merged.insert(p.month.clone(), p);
        }
    }
    report
        .series
        .retain(|s| s.id != "anjuke-second" && !s.id.starts_with("manual:"));
    report.series.push(Series {
        id: "anjuke-second".into(),
        name: "安居客二手房参考价".into(),
        kind: "second".into(),
        basis: "平台参考单价（非成交）".into(),
        unit: "元/㎡".into(),
        source_url: expected.to_string(),
        points: merged.into_values().collect(),
    });
    report.series.extend(manual_series(&saved(root)?, &q));
    report.sources.retain(|s| s.name != "安居客历史房价");
    report.sources.push(Source{name:"安居客历史房价".into(),url:expected.to_string(),status:"live".into(),message:format!("已从用户打开的内置网页读取{year}年历史数据，城市、小区、年份及网址已核验；并非成交均价。")});
    report.communities.extend(communities);
    let mut seen = HashSet::new();
    report.communities.retain(|c| seen.insert(c.id.clone()));
    report.fetched_at = Utc::now().to_rfc3339();
    write(&path, &report)?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn residential_snapshot_requires_city_month_and_listing_basis() {
        let html = r#"<div class="cont_01"><div class="data"><h1>杭州房价（住宅）</h1><span class="cont_tim">（2026年9月挂牌）</span><div class="fl"><span>34,529</span>元/㎡</div><div class="fr">环比：▼3.81%</div></div></div>"#;
        let p = parse_creprice(html, &city("hangzhou").unwrap()).unwrap();
        assert_eq!(p.value, 34529.0);
        assert_eq!(p.month, "2026-09");
        assert_eq!(p.mom, Some(-3.81));
        assert!(parse_creprice(html, &city("beijing").unwrap()).is_err());
    }
    #[test]
    fn official_fixture_preserves_city_type_and_published_changes() {
        let rows = parse_official(
            include_str!("fixtures/nbs-2026-09.html"),
            "https://www.stats.gov.cn/sj/zxfb/202610/t20261019_1965609.html",
        )
        .unwrap();
        assert_eq!(rows.len(), 140);
        let bj = rows
            .iter()
            .find(|r| r.city == "北京" && r.kind == "new")
            .unwrap();
        assert_eq!(bj.month, "2026-09");
        assert!((bj.mom + 0.2).abs() < 1e-8);
        assert!((bj.yoy + 2.7).abs() < 1e-8);
        assert!(rows.iter().any(|r| r.city == "杭州" && r.kind == "second"));
    }
    #[test]
    fn web_source_must_match_exact_city_community_year_and_host() {
        let q = Query {
            city: "hangzhou".into(),
            kind: "second".into(),
            community: Some(Community {
                id: "xq123".into(),
                name: "示例小区".into(),
            }),
        };
        let (_, url) = check_source(&q, 2025).unwrap();
        assert!(matches_source(&url, &url));
        for invalid in [
            "https://evil.example/fangjia/hangzhou2025/xq123/",
            "https://www.anjuke.com/fangjia/beijing2025/xq123/",
            "https://www.anjuke.com/fangjia/hangzhou2024/xq123/",
            "https://www.anjuke.com/fangjia/hangzhou2025/",
            "https://u:p@www.anjuke.com/fangjia/hangzhou2025/xq123/",
        ] {
            assert!(!matches_source(
                &reqwest::Url::parse(invalid).unwrap(),
                &url
            ));
        }
    }
    #[tokio::test]
    #[ignore = "真实房价完整查询与缓存"]
    async fn live_full_report_and_cached_manual_update() {
        let root = std::env::temp_dir().join(format!("housing-live-{}", uuid::Uuid::new_v4()));
        let q = Query {
            city: "hangzhou".into(),
            kind: "all".into(),
            community: None,
        };
        let start = std::time::Instant::now();
        let r = report(&root, q.clone(), true).await.unwrap();
        println!(
            "housing full report {:?}: {:?}",
            start.elapsed(),
            r.series
                .iter()
                .map(|s| (&s.id, s.points.len()))
                .collect::<Vec<_>>()
        );
        for s in &r.sources {
            println!("{} {} {}", s.name, s.status, s.message);
        }
        assert!(r
            .series
            .iter()
            .any(|s| s.id == "nbs-new" && s.points.len() >= 3));
        assert!(r.series.iter().any(|s| s.id == "nbs-second"));
        observe(
            &root,
            q.clone(),
            Observation {
                id: "".into(),
                city: "hangzhou".into(),
                community_id: None,
                community_name: None,
                kind: "new".into(),
                basis: "开发商报价".into(),
                month: "2025-01".into(),
                price: 30000.0,
                source_url: "".into(),
            },
        )
        .await
        .unwrap();
        let r = report(&root, q, false).await.unwrap();
        assert!(r.series.iter().any(|s| s.id.starts_with("manual:")));
        assert!(r.sources.iter().any(|s| s.status == "cached"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn monthly_platform_rows_do_not_read_rankings_as_history() {
        let c = city("hangzhou").unwrap();
        let html = r#"<h1>2026杭州房价走势图</h1><div class="list-table"><div class="table-tr"><div class="td">2026年9月房价</div><div class="td">27836元/㎡</div></div><div class="table-tr"><div class="td">2026年西湖房价</div><div class="td">999999元/㎡</div></div></div>"#;
        let (p, _) = parse_anjuke(html, &c, 2026, None).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].month, "2026-09");
        assert_eq!(p[0].value, 27836.0);
        assert!(parse_anjuke(html, &city("beijing").unwrap(), 2026, None).is_err());
    }
    #[test]
    fn official_index_resets_at_gaps_instead_of_inventing_prices() {
        let rows = vec![
            OfficialRow {
                city: "杭州".into(),
                kind: "new".into(),
                month: "2026-01".into(),
                mom: 1.0,
                yoy: 2.0,
                url: "https://www.stats.gov.cn/".into(),
            },
            OfficialRow {
                city: "杭州".into(),
                kind: "new".into(),
                month: "2026-03".into(),
                mom: -1.0,
                yoy: 1.0,
                url: "https://www.stats.gov.cn/".into(),
            },
        ];
        let s = official_series(&rows, &city("hangzhou").unwrap(), "new").unwrap();
        assert_eq!(s.points.len(), 2);
        assert_eq!(s.points[1].value, 100.0);
        assert_eq!(s.points[1].mom, Some(-1.0));
        assert_ne!(s.points[0].anchor_month, s.points[1].anchor_month);
    }
    #[tokio::test]
    async fn observations_are_separated_by_scope_and_survive_watch_removal() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let q = Query {
            city: "hangzhou".into(),
            kind: "new".into(),
            community: None,
        };
        let o = Observation {
            id: "".into(),
            city: "ignored".into(),
            community_id: None,
            community_name: None,
            kind: "new".into(),
            basis: "开发商报价".into(),
            month: "2025-01".into(),
            price: 30000.0,
            source_url: "".into(),
        };
        let s = observe(&root, q.clone(), o.clone()).await.unwrap();
        assert_eq!(s.observations[0].city, "hangzhou");
        assert!(observe(&root, q.clone(), o.clone()).await.is_err());
        let q2 = Query {
            city: q.city.clone(),
            kind: q.kind.clone(),
            community: Some(Community {
                id: format!("local-{}", uuid::Uuid::new_v4()),
                name: "保留楼盘".into(),
            }),
        };
        observe(&root, q2.clone(), o).await.unwrap();
        let w = watch(&root, q2.clone()).await.unwrap();
        let s = remove(&root, &w[0].id, false).await.unwrap();
        assert_eq!(s.observations.len(), 2);
        assert_eq!(
            s.observations[1].community_name.as_deref(),
            Some("保留楼盘")
        );
        assert_eq!(manual_series(&s, &q).len(), 1);
        assert_eq!(manual_series(&s, &q2).len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    #[ignore = "真实房价网络数据源"]
    async fn live_platform_and_official_parsers() {
        let c = city("hangzhou").unwrap();
        let year = Local::now().year();
        let platform = fetch(&anjuke_url(&c, year, None))
            .await
            .and_then(|html| parse_anjuke(&html, &c, year, None));
        println!(
            "platform: {}",
            match &platform {
                Ok((p, _)) => format!("{} months", p.len()),
                Err(e) => format!("unavailable: {e}"),
            }
        );
        let html = fetch("https://www.stats.gov.cn/sj/zxfb/").await.unwrap();
        let doc = Document::from(html.as_str());
        let href = doc
            .select("a[href]")
            .iter()
            .find_map(|a| {
                if text(&a.text()).contains("70个大中城市商品住宅销售价格变动情况")
                {
                    a.attr("href").map(|s| s.to_string())
                } else {
                    None
                }
            })
            .unwrap();
        let url = reqwest::Url::parse("https://www.stats.gov.cn/sj/zxfb/")
            .unwrap()
            .join(&href)
            .unwrap();
        let rows = parse_official(&fetch(url.as_str()).await.unwrap(), url.as_str()).unwrap();
        println!(
            "platform {} months; official {} city/type rows",
            platform.as_ref().map(|(p, _)| p.len()).unwrap_or(0),
            rows.len()
        );
        assert!(rows.iter().any(|r| r.city == "杭州" && r.kind == "new"));
    }
}
