//! 汽车销量、报价快照与金属行情。每个来源、单位、指标独立保存，缺失值不补零。
use chrono::{Datelike, Local, NaiveDate, Utc};
use dom_query::Document;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::Path, time::Duration};
use tokio::task::JoinSet;
static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .user_agent(crate::trending::http::UA)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap()
});
#[derive(Clone, Serialize, Deserialize)]
pub struct Subject {
    pub id: String,
    pub name: String,
    pub category: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Query {
    pub domain: String,
    pub subject: String,
    pub month: String,
    pub segment: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Point {
    pub date: String,
    pub value: f64,
    pub url: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Series {
    pub id: String,
    pub subject: String,
    pub name: String,
    pub basis: String,
    pub unit: String,
    pub frequency: String,
    pub points: Vec<Point>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Source {
    pub name: String,
    pub url: String,
    pub status: String,
    pub message: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub query: Query,
    pub fetched_at: String,
    pub subjects: Vec<Subject>,
    pub series: Vec<Series>,
    pub sources: Vec<Source>,
    pub notes: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Watch {
    pub query: Query,
    pub name: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Observation {
    pub id: String,
    pub domain: String,
    pub subject: String,
    pub name: String,
    pub basis: String,
    pub unit: String,
    pub date: String,
    pub value: f64,
    pub url: String,
}
#[derive(Default, Serialize, Deserialize)]
pub struct Saved {
    pub watches: Vec<Watch>,
    pub observations: Vec<Observation>,
}
#[derive(Serialize, Deserialize)]
struct Cache {
    time: i64,
    value: Value,
}
fn write<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("无效路径")?).map_err(|e| e.to_string())?;
    crate::db::vault::write_json(path, value).map_err(|e| e.to_string())
}
fn saved(root: &Path) -> Result<Saved, String> {
    let p = root.join("saved.json");
    if !p.exists() {
        return Ok(Saved::default());
    }
    serde_json::from_slice(&fs::read(p).map_err(|e| e.to_string())?)
        .map_err(|e| format!("追踪记录读取失败：{e}"))
}
pub fn metals() -> Vec<Subject> {
    [
        ("AU0", "黄金", "贵金属"),
        ("AG0", "白银", "贵金属"),
        ("CU0", "铜", "工业金属"),
        ("AL0", "铝", "工业金属"),
        ("LC0", "锂 · 碳酸锂", "能源金属"),
        ("APT", "钨 · 仲钨酸铵", "小金属"),
        ("ZN0", "锌", "工业金属"),
        ("PB0", "铅", "工业金属"),
        ("NI0", "镍", "工业金属"),
        ("SN0", "锡", "工业金属"),
    ]
    .into_iter()
    .map(|(id, name, category)| Subject {
        id: id.into(),
        name: name.into(),
        category: category.into(),
    })
    .collect()
}
fn valid_month(s: &str) -> bool {
    NaiveDate::parse_from_str(&format!("{s}-01"), "%Y-%m-%d").is_ok_and(|d| {
        d.format("%Y-%m").to_string() == s && d <= Local::now().date_naive() && d.year() >= 2000
    })
}
fn valid_day(s: &str) -> bool {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok_and(|d| {
        d.format("%Y-%m-%d").to_string() == s && d <= Local::now().date_naive() && d.year() >= 2000
    })
}
fn validate(q: &Query) -> Result<(), String> {
    if !valid_month(&q.month) {
        return Err("请选择有效月份".into());
    }
    match q.domain.as_str() {
        "cars" => {
            if !["all", "sedan", "suv", "nev"].contains(&q.segment.as_str())
                || (!q.subject.is_empty()
                    && (q.subject.len() > 12 || !q.subject.bytes().all(|b| b.is_ascii_digit())))
            {
                return Err("无效汽车筛选条件".into());
            }
        }
        "metals" => {
            if !metals().iter().any(|s| s.id == q.subject) {
                return Err("不支持的金属品种".into());
            }
        }
        _ => return Err("无效追踪类型".into()),
    }
    Ok(())
}
pub async fn bootstrap(root: &Path) -> Result<Saved, String> {
    let _g = LOCK.lock().await;
    saved(root)
}
pub async fn mutate(
    root: &Path,
    action: &str,
    watch: Option<Watch>,
    observation: Option<Observation>,
    id: Option<String>,
) -> Result<Saved, String> {
    let _g = LOCK.lock().await;
    let mut s = saved(root)?;
    match action {
        "watch" => {
            let w = watch.ok_or("缺少追踪对象")?;
            validate(&w.query)?;
            if w.query.subject.is_empty()
                || w.name.trim().is_empty()
                || w.name.chars().count() > 100
            {
                return Err("请选择具体车型或金属".into());
            }
            s.watches.retain(|x| {
                !(x.query.domain == w.query.domain
                    && x.query.subject == w.query.subject
                    && x.query.segment == w.query.segment)
            });
            if s.watches.len() >= 100 {
                return Err("最多保存100个追踪对象".into());
            }
            s.watches.push(w);
        }
        "unwatch" => {
            let w = watch.ok_or("缺少追踪对象")?;
            s.watches.retain(|x| {
                !(x.query.domain == w.query.domain
                    && x.query.subject == w.query.subject
                    && x.query.segment == w.query.segment)
            });
        }
        "observe" => {
            let mut o = observation.ok_or("缺少记录")?;
            validate(&Query {
                domain: o.domain.clone(),
                subject: o.subject.clone(),
                month: o.date.get(..7).unwrap_or("").into(),
                segment: "all".into(),
            })?;
            if o.subject.is_empty()
                || !valid_day(&o.date)
                || !o.value.is_finite()
                || o.value <= 0.0
                || o.value > 1e10
                || o.name.trim().is_empty()
                || o.name.chars().count() > 100
                || o.basis.trim().is_empty()
                || o.basis.chars().count() > 200
                || !["元/辆", "元/克", "元/千克", "元/吨"].contains(&o.unit.as_str())
                || (o.domain == "cars" && o.unit != "元/辆")
            {
                return Err("请核对日期、价格、品种、单位和报价口径".into());
            }
            let url = reqwest::Url::parse(&o.url).map_err(|_| "请填写有效来源网址")?;
            if !["https", "http"].contains(&url.scheme())
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err("请填写HTTP来源网址".into());
            }
            if s.observations.len() >= 10000 {
                return Err("最多保存10000条记录".into());
            }
            if s.observations.iter().any(|x| {
                x.domain == o.domain
                    && x.subject == o.subject
                    && x.basis == o.basis
                    && x.unit == o.unit
                    && x.url == o.url
                    && x.date == o.date
            }) {
                return Err("同日同口径记录已存在，请先删除旧记录".into());
            }
            o.id = uuid::Uuid::new_v4().to_string();
            s.observations.push(o);
        }
        "delete" => {
            s.observations.retain(|o| Some(&o.id) != id.as_ref());
        }
        _ => return Err("不支持的操作".into()),
    }
    write(&root.join("saved.json"), &s)?;
    Ok(s)
}
async fn download(url: &str) -> Result<String, String> {
    let mut response = CLIENT
        .get(url)
        .send()
        .await
        .map_err(|e| format!("来源连接失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("来源响应失败：{e}"))?;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > 8_000_000 {
            return Err("来源响应过大".into());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| "来源编码无法识别".into())
}
async fn fetch(
    root: &Path,
    key: &str,
    url: &str,
    force: bool,
    parser: fn(&str) -> Result<Value, String>,
) -> Result<(Value, String, String), String> {
    let p = root.join("cache").join(format!("{key}.json"));
    let cached = fs::read(&p)
        .ok()
        .and_then(|b| serde_json::from_slice::<Cache>(&b).ok());
    if !force {
        if let Some(c) = &cached {
            if Utc::now().timestamp() - c.time < 21600 {
                return Ok((
                    c.value.clone(),
                    "cached".into(),
                    format!(
                        "缓存获取时间：{}",
                        chrono::DateTime::from_timestamp(c.time, 0)
                            .map(|t| t.to_rfc3339())
                            .unwrap_or_default()
                    ),
                ));
            }
        }
    }
    let fetched = match download(url).await {
        Ok(t) => parser(&t),
        Err(e) => Err(e),
    };
    match fetched {
        Ok(value) => {
            write(
                &p,
                &Cache {
                    time: Utc::now().timestamp(),
                    value: value.clone(),
                },
            )?;
            Ok((value, "live".into(), "已核验结构与数据日期".into()))
        }
        Err(e) => match cached {
            Some(c) => Ok((
                c.value,
                "stale".into(),
                format!(
                    "刷新失败，展示旧缓存（获取时间{}）：{e}",
                    chrono::DateTime::from_timestamp(c.time, 0)
                        .map(|t| t.to_rfc3339())
                        .unwrap_or_default()
                ),
            )),
            None => Err(e),
        },
    }
}
fn number(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str()?.replace(',', "").parse().ok())
        .filter(|x| x.is_finite())
}
fn script_json(html: &str, id: &str) -> Result<Value, String> {
    let doc = Document::from(html);
    serde_json::from_str(&doc.select(&format!("script#{id}")).text())
        .map_err(|_| "来源未返回可验证的结构化数据，可能需要人工验证".into())
}
#[cfg(test)]
fn parse_cars(html: &str) -> Result<Value, String> {
    let v = script_json(html, "__NEXT_DATA__")?;
    let p = &v["props"]["pageProps"];
    let date = p["initialValues"]["date"].as_str().ok_or("缺少榜单月份")?;
    if !valid_month(date) {
        return Err("榜单日期无效".into());
    }
    let list = p["listRes"]["list"].as_array().ok_or("缺少销量榜")?;
    let rows:Vec<Value>=list.iter().filter_map(|r|{let id=r["seriesid"].as_str()?;let name=r["seriesname"].as_str()?;let sales=number(&r["salecount"])?;if id.is_empty()||!id.bytes().all(|b|b.is_ascii_digit())||sales<0.0||sales.fract()!=0.0||name.is_empty(){return None;}Some(json!({"id":id,"name":name,"sales":sales,"price":r["priceinfo"].as_str().unwrap_or("")}))}).collect();
    if rows.is_empty() {
        return Err("榜单暂无有效车型数据".into());
    }
    Ok(
        json!({"month":date,"rows":rows,"segment":p["initialValues"]["levelid"],"type":p["initialValues"]["typeid"],"subtype":p["initialValues"]["subranktypeid"],"priceDate":Local::now().format("%Y-%m-%d").to_string()}),
    )
}

fn parse_car_api(text: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(text).map_err(|_| "来源没有返回销量数据")?;
    if v["returncode"].as_i64() != Some(0) {
        return Err("汽车销量接口返回失败".into());
    }
    let result = &v["result"];
    let pages = number(&result["pagecount"]).ok_or("缺少总页数")?;
    let page = number(&result["pageindex"]).ok_or("缺少当前页")?;
    if pages == 0.0
        || result["list"]
            .as_array()
            .is_some_and(|list| list.is_empty())
    {
        return Err("该月暂无已发布销量，或来源已不再提供此月份".into());
    }
    if pages < 1.0
        || pages > 10.0
        || pages.fract() != 0.0
        || page < 1.0
        || page > pages
        || page.fract() != 0.0
    {
        return Err("月榜分页无效或超出范围".into());
    }
    let list = result["list"].as_array().ok_or("缺少月榜车型")?;
    let mut month = None;
    let mut kind = None;
    let mut subtype = None;
    let mut level = None;
    let mut rows = vec![];
    let mut ids = std::collections::HashSet::new();
    for row in list {
        let id = row["seriesid"].as_str().ok_or("缺少车型编号")?;
        let name = row["seriesname"].as_str().ok_or("缺少车型名称")?;
        let sale = number(&row["salecount"]).ok_or("缺少月销量")?;
        let meta: Value = serde_json::from_str(
            row["shareinfo"]["shareext"]
                .as_str()
                .ok_or("缺少数据月份凭据")?,
        )
        .map_err(|_| "月份凭据无效")?;
        let date = meta["date"].as_str().ok_or("缺少数据月份")?;
        if !valid_month(date)
            || id.is_empty()
            || !id.bytes().all(|b| b.is_ascii_digit())
            || sale < 0.0
            || sale.fract() != 0.0
            || meta["seriesid"] != id
            || !ids.insert(id.to_string())
        {
            return Err("月榜车型或月份无效".into());
        }
        let link = reqwest::Url::parse(
            row["rightinfo"]["righttexttwolinkurl"]
                .as_str()
                .ok_or("缺少分类凭据")?,
        )
        .map_err(|_| "分类凭据无效")?;
        let inner = link
            .query_pairs()
            .find(|(k, _)| k == "url")
            .map(|(_, v)| v.into_owned())
            .ok_or("缺少分类链接")?;
        let params = reqwest::Url::parse(&inner).map_err(|_| "分类链接无效")?;
        let params: std::collections::HashMap<String, String> = params
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        if params.get("date").map(String::as_str) != Some(date)
            || params.get("seriesid").map(String::as_str) != Some(id)
        {
            return Err("月份或车型凭据不一致".into());
        }
        let current_level = params
            .get("levelid")
            .filter(|s| !s.is_empty())
            .map(String::as_str)
            .unwrap_or("0");
        for (target, current) in [
            (&mut month, date),
            (&mut kind, meta["typeid"].as_str().ok_or("缺少榜单类型")?),
            (
                &mut subtype,
                meta["subranktypeid"].as_str().ok_or("缺少子榜类型")?,
            ),
            (&mut level, current_level),
        ] {
            if target.as_ref().is_some_and(|old| old != current) {
                return Err("来源混入不同月份或分类".into());
            }
            *target = Some(current.to_string());
        }
        rows.push(json!({"id":id,"name":name,"sales":sale,"price":row["priceinfo"].as_str().unwrap_or("")}));
    }
    if rows.is_empty() {
        return Err("该月暂无已发布销量".into());
    }
    Ok(
        json!({"month":month,"type":kind,"subtype":subtype,"segment":level,"rows":rows,"pages":pages as usize,"page":page as usize,"priceDate":Local::now().format("%Y-%m-%d").to_string()}),
    )
}
fn car_api_url(month: &str, segment: &str) -> String {
    let (kind, sub, level) = match segment {
        "nev" => ("9", "2305", "0"),
        "sedan" => ("1", "1", "1,2,3,4,5,6"),
        "suv" => ("1", "1", "16,17,18,19,20"),
        _ => ("1", "1", "0"),
    };
    let mut url =
        reqwest::Url::parse("https://www.autohome.com.cn/web-main/car/rank/getList").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("from", "28"),
        ("pm", "2"),
        ("pluginversion", "11.75.8"),
        ("model", "1"),
        ("channel", "0"),
        ("typeid", kind),
        ("subranktypeid", sub),
        ("levelid", level),
        ("price", "0-9000"),
        ("date", month),
        ("pageindex", "1"),
        ("pagesize", "1000"),
    ]);
    url.to_string()
}
async fn fetch_car_month(
    root: &Path,
    month: &str,
    segment: &str,
    force: bool,
) -> Result<(Value, String, String), String> {
    let url = car_api_url(month, segment);
    let (mut value, mut status, _) = fetch(
        root,
        &format!("cars-full-v3-{segment}-{month}-1"),
        &url,
        force,
        parse_car_api,
    )
    .await?;
    let pages = value["pages"].as_u64().ok_or("缺少总页数")?;
    if value["page"] != 1 {
        return Err("月榜返回了其他页".into());
    }
    let mut rows = value["rows"].as_array().cloned().ok_or("缺少车型")?;
    for row in &mut rows {
        row["sourceUrl"] = json!(url);
        row["priceDate"] = value["priceDate"].clone();
    }
    for page in 2..=pages {
        let mut page_url = reqwest::Url::parse(&url).unwrap();
        let params: Vec<(String, String)> = page_url
            .query_pairs()
            .map(|(k, v)| {
                let next_value = if k == "pageindex" {
                    page.to_string()
                } else {
                    v.into_owned()
                };
                (k.into_owned(), next_value)
            })
            .collect();
        page_url.set_query(None);
        page_url.query_pairs_mut().extend_pairs(params);
        let (next, page_status, _) = fetch(
            root,
            &format!("cars-full-v3-{segment}-{month}-{page}"),
            page_url.as_str(),
            force,
            parse_car_api,
        )
        .await?;
        if next["page"] != page
            || next["pages"] != pages
            || ["month", "type", "subtype", "segment"]
                .iter()
                .any(|key| next[*key] != value[*key])
        {
            return Err("月榜分页的月份或分类不一致".into());
        }
        if page_status == "stale" || status == "stale" {
            status = "stale".into();
        } else if page_status == "live" {
            status = "live".into();
        }
        let mut next_rows = next["rows"].as_array().cloned().ok_or("分页没有车型")?;
        for row in &mut next_rows {
            row["sourceUrl"] = json!(page_url.as_str());
            row["priceDate"] = next["priceDate"].clone();
        }
        rows.extend(next_rows);
    }
    let mut ids = std::collections::HashSet::new();
    if rows
        .iter()
        .any(|row| !ids.insert(row["id"].as_str().unwrap_or("").to_string()))
    {
        return Err("月榜分页存在重复车型，已拒绝混入".into());
    }
    let message = format!(
        "已获取 {} 款车型，共 {pages} 页{}",
        rows.len(),
        if status == "stale" {
            "；部分分页刷新失败，使用旧缓存，以数据日期为准"
        } else {
            ""
        }
    );
    value["rows"] = json!(rows);
    Ok((value, status, message))
}

fn parse_futures(text: &str) -> Result<Value, String> {
    let start = text.find("([").ok_or("来源未返回行情数组")? + 1;
    let end = text.rfind(']').ok_or("行情数组不完整")?;
    let rows: Vec<Value> =
        serde_json::from_str(&text[start..=end]).map_err(|_| "行情格式已改变")?;
    let mut map = BTreeMap::new();
    for r in rows {
        if let (Some(date), Some(value)) = (r["d"].as_str(), number(&r["c"])) {
            if valid_day(date) && value > 0.0 {
                map.insert(date.to_string(), json!({"date":date,"value":value}));
            }
        }
    }
    if map.is_empty() {
        return Err("来源没有有效收盘数据".into());
    }
    Ok(Value::Array(
        map.into_values()
            .rev()
            .take(1500)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect(),
    ))
}

fn range(raw: &str) -> Option<(f64, f64)> {
    let clean = raw.trim();
    let mut iter = clean.split('-');
    let a: f64 = iter.next()?.parse().ok()?;
    let b: f64 = iter.next().unwrap_or(clean).parse().ok()?;
    if iter.next().is_some() || !a.is_finite() || !b.is_finite() || a <= 0.0 || a > b {
        return None;
    }
    Some((a, b))
}
fn price_range(raw: &str) -> Option<(f64, f64)> {
    let r = range(raw.strip_suffix('万')?)?;
    Some(((r.0 * 10000.0).round(), (r.1 * 10000.0).round()))
}
fn source(name: String, url: String, result: &Result<(Value, String, String), String>) -> Source {
    match result {
        Ok((_, s, m)) => Source {
            name,
            url,
            status: s.clone(),
            message: m.clone(),
        },
        Err(e) => Source {
            name,
            url,
            status: if e.starts_with("该月暂无") {
                "unavailable"
            } else {
                "failed"
            }
            .into(),
            message: e.clone(),
        },
    }
}
fn add(
    series: &mut Vec<Series>,
    id: String,
    subject: &str,
    name: &str,
    basis: &str,
    unit: &str,
    freq: &str,
    date: &str,
    value: f64,
    url: &str,
) {
    if let Some(s) = series.iter_mut().find(|s| s.id == id) {
        s.points.retain(|p| p.date != date);
        s.points.push(Point {
            date: date.into(),
            value,
            url: url.into(),
        });
    } else {
        series.push(Series {
            id,
            subject: subject.into(),
            name: name.into(),
            basis: basis.into(),
            unit: unit.into(),
            frequency: freq.into(),
            points: vec![Point {
                date: date.into(),
                value,
                url: url.into(),
            }],
        });
    }
}
fn parse_tungsten(html: &str) -> Result<Value, String> {
    let doc = Document::from(html);
    let date_text = doc
        .select("time")
        .first()
        .attr("datetime")
        .map(|s| s.to_string())
        .ok_or("文章缺少发布日期")?;
    let date = date_text.get(..10).ok_or("发布日期无效")?;
    if !valid_day(date) {
        return Err("文章日期无效".into());
    }
    for p in doc.select("p").iter() {
        let text = p.text().to_string();
        let t = text.trim();
        if !(t.starts_with("仲钨酸铵（APT）价格") || t.starts_with("仲钨酸铵（APT）报价"))
        {
            continue;
        }
        if let Some(i) = t.find("万元/吨") {
            let prefix = &t[..i];
            let nums: String = prefix
                .chars()
                .rev()
                .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
                .collect::<String>()
                .chars()
                .rev()
                .collect();
            let intro = prefix.strip_suffix(&nums).unwrap_or("");
            let absolute = [
                "价格调整至",
                "报价调整至",
                "价格为",
                "报价为",
                "价格维持在",
                "报价维持在",
                "价格在",
                "报价在",
                "报价处于",
                "价格处于",
                "价格暂稳在",
                "报价暂稳在",
                "价格降至",
                "报价降至",
                "价格跌至",
                "价格下跌至",
                "报价跌至",
                "价格涨至",
                "报价涨至",
                "价格弱调至",
                "报价弱调至",
            ]
            .iter()
            .any(|word| intro.ends_with(word));
            if !absolute {
                continue;
            }
            if let Some((low, high)) = range(&nums) {
                return Ok(json!({"date":date,"low":low*10000.0,"high":high*10000.0}));
            }
        }
    }
    Err("文章没有可核验的仲钨酸铵价格区间；图片报价及模糊描述不转成曲线".into())
}
async fn tungsten(root: &Path, force: bool, report: &mut Report) {
    let url = "https://www.ctia.com.cn/news/tungsten-news";
    let html = match download(url).await {
        Ok(s) => s,
        Err(e) => {
            report.sources.push(Source {
                name: "中钨在线公开报道".into(),
                url: url.into(),
                status: "failed".into(),
                message: e,
            });
            return;
        }
    };
    let urls = {
        let doc = Document::from(html.as_str());
        let mut urls = vec![];
        for a in doc.select("a[href]").iter() {
            if let Some(href) = a.attr("href") {
                if let Some(n) = href
                    .strip_prefix("https://www.ctia.com.cn/news/")
                    .and_then(|s| s.strip_suffix(".html"))
                {
                    if n.bytes().all(|b| b.is_ascii_digit())
                        && !n.is_empty()
                        && !urls.contains(&href.to_string())
                    {
                        urls.push(href.to_string());
                    }
                }
            }
            if urls.len() >= 8 {
                break;
            }
        }
        urls
    };
    for batch in urls.chunks(4) {
        let mut jobs = JoinSet::new();
        for url in batch {
            let root = root.to_path_buf();
            let url = url.clone();
            jobs.spawn(async move {
                let key = url.rsplit('/').next().unwrap().replace('.', "-");
                let r = fetch(&root, &format!("w-{key}"), &url, force, parse_tungsten).await;
                (url, r)
            });
        }
        while let Some(Ok((url, r))) = jobs.join_next().await {
            report
                .sources
                .push(source("中钨在线 · APT公开报道".into(), url.clone(), &r));
            if let Ok((v, _, _)) = r {
                for (field, name) in [("low", "报价下限"), ("high", "报价上限")] {
                    if let (Some(date), Some(value)) = (v["date"].as_str(), number(&v[field])) {
                        add(
                            &mut report.series,
                            format!("APT-{field}"),
                            "APT",
                            name,
                            "中钨在线公开报道 · 仲钨酸铵（APT）议价范围（非纯钨）",
                            "元/吨",
                            "daily",
                            date,
                            value,
                            &url,
                        );
                    }
                }
            }
        }
    }
    report.notes.push("钨以仲钨酸铵（APT）公开议价区间追踪，按报道日期记录；不是金属钨、钨粉或钨精矿价格，未读取登录或付费报价。缺少日期保留断点。".into());
}
pub async fn report(root: &Path, q: Query, force: bool) -> Result<Report, String> {
    validate(&q)?;
    let mut r = Report {
        query: q.clone(),
        fetched_at: Utc::now().to_rfc3339(),
        subjects: vec![],
        series: vec![],
        sources: vec![],
        notes: vec![],
    };
    if q.domain == "metals" {
        r.subjects = metals();
        if q.subject == "APT" {
            tungsten(root, force, &mut r).await;
        } else {
            let url=format!("https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_data=/InnerFuturesNewService.getDailyKLine?symbol={}",q.subject);
            let data = fetch(root, &q.subject, &url, force, parse_futures).await;
            r.sources
                .push(source("新浪财经 · 国内期货日线".into(), url.clone(), &data));
            if let Ok((v, _, _)) = data {
                let unit = match q.subject.as_str() {
                    "AU0" => "元/克",
                    "AG0" => "元/千克",
                    _ => "元/吨",
                };
                for p in v.as_array().into_iter().flatten() {
                    if let (Some(date), Some(value)) = (p["date"].as_str(), number(&p["value"])) {
                        add(
                            &mut r.series,
                            format!("futures-{}", q.subject),
                            &q.subject,
                            "连续合约日收盘价",
                            "国内期货连续合约 · 日收盘（未复权）",
                            unit,
                            "daily",
                            date,
                            value,
                            &url,
                        );
                    }
                }
            }
            r.notes.push("期货连续合约不等于现货、零售或回收价；主力合约切换可能产生跳变。碳酸锂是锂化合物，不是金属锂。日线可能延迟，以数据日期为准。".into());
        }
    } else {
        let start = NaiveDate::parse_from_str(&format!("{}-01", q.month), "%Y-%m-%d").unwrap();
        let index = start.year() * 12 + start.month0() as i32;
        let mut tasks = JoinSet::new();
        for batch in (0..13).collect::<Vec<_>>().chunks(4) {
            for back in batch {
                let i = index - back;
                let month = format!("{}-{:02}", i / 12, i % 12 + 1);
                let url = car_api_url(&month, &q.segment);
                let root = root.to_path_buf();
                let segment = q.segment.clone();
                tasks.spawn(async move {
                    let data = fetch_car_month(&root, &month, &segment, force).await;
                    (month, url, data)
                });
            }
            while let Some(Ok((month, url, data))) = tasks.join_next().await {
                let data = data.and_then(|(v, s, m)| {
                    let expected_level = match q.segment.as_str() {
                        "sedan" => "1,2,3,4,5,6",
                        "suv" => "16,17,18,19,20",
                        _ => "0",
                    };
                    let expected_type = if q.segment == "nev" { "9" } else { "1" };
                    if v["month"] != month
                        || v["segment"].as_str() != Some(expected_level)
                        || v["type"].as_str() != Some(expected_type)
                        || v["subtype"].as_str()
                            != Some(if q.segment == "nev" { "2305" } else { "1" })
                    {
                        Err("来源返回了其他月份或分类，已拒绝混入".into())
                    } else {
                        Ok((v, s, m))
                    }
                });
                r.sources.push(source(
                    format!("汽车之家 · {month} 月榜"),
                    url.clone(),
                    &data,
                ));
                if let Ok((v, _, _)) = data {
                    for row in v["rows"].as_array().into_iter().flatten() {
                        let id = row["id"].as_str().unwrap();
                        let name = row["name"].as_str().unwrap();
                        let row_url = row["sourceUrl"].as_str().unwrap_or(&url);
                        if !r.subjects.iter().any(|s| s.id == id) {
                            r.subjects.push(Subject {
                                id: id.into(),
                                name: name.into(),
                                category: q.segment.clone(),
                            });
                        }
                        add(
                            &mut r.series,
                            format!("sales-{id}"),
                            id,
                            "月销量",
                            "汽车之家车系月销榜 · 平台综合销量统计",
                            "辆/月",
                            "monthly",
                            &month,
                            number(&row["sales"]).unwrap(),
                            row_url,
                        );
                        // 历史榜单上的 priceinfo 可能是当前报价，只在请求月份这一页记录抓取日快照。
                        if month == q.month {
                            if let Some((low, high)) = row["price"].as_str().and_then(price_range) {
                                let day = row["priceDate"].as_str().unwrap_or("").to_string();
                                for (suffix, title, val) in [
                                    ("low", "平台展示价格下限", low),
                                    ("high", "平台展示价格上限", high),
                                ] {
                                    add(
                                        &mut r.series,
                                        format!("price-{id}-{suffix}"),
                                        id,
                                        title,
                                        &format!("平台{}月榜展示车系价格范围 · 抓取日快照（非历史成交价）", q.month),
                                        "元/辆",
                                        "daily",
                                        &day,
                                        val,
                                        row_url,
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
        r.notes.push("自动读取所选月份及之前12个月的完整车型月榜（以来源实际发布范围为准），按车型编号连接历史月份。未发布、未上市或读取失败的月份不补零；新能源与车身分类使用各自榜单，不据此推算全市场份额。".into());
        r.notes.push("价格为抓取当日的平台车系展示范围，可能覆盖不同年款和配置，不能作为历史月份价格或单一配置降价证据。刷新成功的快照保存在本机；成交参考报价可按城市、配置与来源另行记录。".into());
    }
    // 合并已保存的自动价格快照；只有当前抓取的数据日期参与覆盖。
    let key = if q.domain == "cars" {
        format!("cars-{}-{}", q.segment, q.month)
    } else {
        q.subject.clone()
    };
    let p = root.join(format!("history-{key}.json"));
    {
        let _g = LOCK.lock().await;
        let history: Vec<Series> = if p.exists() {
            serde_json::from_slice(&fs::read(&p).map_err(|e| e.to_string())?)
                .map_err(|e| format!("历史记录损坏：{e}"))?
        } else {
            vec![]
        };
        for old in history {
            if q.domain == "cars" && !old.id.starts_with("price-") {
                continue;
            }
            for point in old.points {
                if !r
                    .series
                    .iter()
                    .any(|s| s.id == old.id && s.points.iter().any(|p| p.date == point.date))
                {
                    add(
                        &mut r.series,
                        old.id.clone(),
                        &old.subject,
                        &old.name,
                        &old.basis,
                        &old.unit,
                        &old.frequency,
                        &point.date,
                        point.value,
                        &point.url,
                    );
                }
            }
        }
        if !r.series.is_empty() {
            let auto: Vec<Series> = r
                .series
                .iter()
                .filter(|s| q.domain == "metals" || s.id.starts_with("price-"))
                .cloned()
                .collect();
            write(&p, &auto)?;
        }
        let s = saved(root)?;
        for o in s
            .observations
            .into_iter()
            .filter(|o| o.domain == q.domain && (q.domain == "cars" || o.subject == q.subject))
        {
            if !r.subjects.iter().any(|s| s.id == o.subject) {
                r.subjects.push(Subject {
                    id: o.subject.clone(),
                    name: o.name.clone(),
                    category: "已记录".into(),
                });
            }
            let id = format!("manual:{}:{}:{}:{}", o.subject, o.basis, o.unit, o.url);
            add(
                &mut r.series,
                id,
                &o.subject,
                "手动报价",
                &o.basis,
                &o.unit,
                "daily",
                &o.date,
                o.value,
                &o.url,
            );
        }
    }
    for s in &mut r.series {
        s.points.sort_by(|a, b| a.date.cmp(&b.date));
    }
    if q.domain == "cars" {
        let sales: std::collections::HashMap<String, f64> = r
            .series
            .iter()
            .filter(|s| s.id.starts_with("sales-"))
            .filter_map(|s| {
                s.points
                    .iter()
                    .find(|p| p.date == q.month)
                    .map(|p| (s.subject.clone(), p.value))
            })
            .collect();
        r.subjects.sort_by(|a, b| {
            sales
                .get(&b.id)
                .unwrap_or(&0.0)
                .total_cmp(sales.get(&a.id).unwrap_or(&0.0))
                .then_with(|| a.name.cmp(&b.name))
        });
    } else {
        r.subjects.sort_by(|a, b| a.name.cmp(&b.name));
    }
    Ok(r)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn futures_rejects_invalid_and_preserves_dates() {
        let v=parse_futures("var _data=([{\"d\":\"2025-02-01\",\"c\":\"12.5\"},{\"d\":\"2025-02-30\",\"c\":\"10\"},{\"d\":\"2025-02-02\",\"c\":\"0\"}]);").unwrap();
        assert_eq!(v.as_array().unwrap().len(), 1);
        assert_eq!(v[0]["value"], 12.5);
        assert!(parse_futures("blocked").is_err());
    }
    #[test]
    fn quotes_are_ranges_not_midpoints() {
        assert_eq!(price_range("6.48-9.48万"), Some((64800.0, 94800.0)));
        assert!(price_range("暂无").is_none());
        assert!(price_range("9-6万").is_none());
        assert!(price_range("NaN万").is_none());
    }
    #[test]
    fn month_and_scope_validation() {
        assert!(valid_month("2025-02"));
        assert!(!valid_month("2025-2"));
        assert!(!valid_month("2099-01"));
        assert!(!valid_day("2025-02-30"));
        assert!(validate(&Query {
            domain: "metals".into(),
            subject: "../../bad".into(),
            month: "2025-02".into(),
            segment: "all".into()
        })
        .is_err());
    }
    #[test]
    fn tungsten_only_explicit_apt_price() {
        let html = r#"<time datetime="2025-10-16T10:00:00"></time><p>仲钨酸铵（APT）价格调整至42-46万元/吨水平。</p>"#;
        let v = parse_tungsten(html).unwrap();
        assert_eq!(v["low"], 420000.0);
        assert_eq!(v["high"], 460000.0);
        assert!(parse_tungsten("<p>钨价40万元/吨</p>").is_err());
        assert!(parse_tungsten(r#"<time datetime="2025-10-16T10:00:00"></time><p>仲钨酸铵（APT）价格下降10万元/吨。</p>"#).is_err());
    }
    #[tokio::test]
    #[ignore]
    async fn live_sources() {
        let p = std::env::temp_dir().join(format!("gold-earth-trackers-{}", uuid::Uuid::new_v4()));
        let q = Query {
            domain: "metals".into(),
            subject: "AU0".into(),
            month: Local::now().format("%Y-%m").to_string(),
            segment: "all".into(),
        };
        let r = report(&p, q, true).await.unwrap();
        assert!(r.series[0].points.len() > 100);
        println!("gold {} points", r.series[0].points.len());
        let text = download("https://www.autohome.com.cn/rank/1.html")
            .await
            .unwrap();
        let cars = parse_cars(&text).unwrap();
        assert!(cars["rows"].as_array().unwrap().len() >= 10);
        println!("cars {}", cars["month"]);
    }
    #[test]
    fn car_fixture_preserves_month_model_sales_and_snapshot_date() {
        let v = parse_cars(include_str!("tracker-fixtures/cars.html")).unwrap();
        assert_eq!(v["month"], "2026-09");
        assert_eq!(v["rows"][0]["id"], "5769");
        assert_eq!(v["rows"][0]["sales"], 50359.0);
        assert_eq!(v["priceDate"], Local::now().format("%Y-%m-%d").to_string());
        assert!(parse_cars("<html>verification required</html>").is_err());
    }
    #[tokio::test]
    async fn observations_are_validated_and_survive_unwatch() {
        let root = std::env::temp_dir().join(format!("ge-trackers-{}", uuid::Uuid::new_v4()));
        let q = Query {
            domain: "cars".into(),
            subject: "5769".into(),
            month: "2025-01".into(),
            segment: "all".into(),
        };
        let w = Watch {
            query: q,
            name: "Model Y".into(),
        };
        mutate(&root, "watch", Some(w.clone()), None, None)
            .await
            .unwrap();
        let o = Observation {
            id: "".into(),
            domain: "cars".into(),
            subject: "5769".into(),
            name: "Model Y".into(),
            basis: "上海 同款 经销商裸车价".into(),
            unit: "元/辆".into(),
            date: "2025-01-01".into(),
            value: 250000.0,
            url: "https://example.com/quote".into(),
        };
        let a = mutate(&root, "observe", None, Some(o.clone()), None)
            .await
            .unwrap();
        assert_eq!(a.observations.len(), 1);
        assert!(mutate(&root, "observe", None, Some(o.clone()), None)
            .await
            .is_err());
        let mut invalid = o.clone();
        invalid.date = "2025-02-30".into();
        assert!(mutate(&root, "observe", None, Some(invalid), None)
            .await
            .is_err());
        let a = mutate(&root, "unwatch", Some(w), None, None).await.unwrap();
        assert!(a.watches.is_empty());
        assert_eq!(a.observations.len(), 1);
        let a = mutate(
            &root,
            "delete",
            None,
            None,
            Some(a.observations[0].id.clone()),
        )
        .await
        .unwrap();
        assert!(a.observations.is_empty());
    }
    #[tokio::test]
    async fn cached_data_retains_original_price_date_and_fallback() {
        let root = std::env::temp_dir().join(format!("ge-tracker-cache-{}", uuid::Uuid::new_v4()));
        let value = json!({"priceDate":"2025-01-01","rows":[1]});
        write(
            &root.join("cache/test.json"),
            &Cache {
                time: Utc::now().timestamp(),
                value: value.clone(),
            },
        )
        .unwrap();
        let (v, status, _) = fetch(&root, "test", "http://127.0.0.1:1", false, parse_cars)
            .await
            .unwrap();
        assert_eq!(status, "cached");
        assert_eq!(v["priceDate"], "2025-01-01");
        let (v, status, _) = fetch(&root, "test", "http://127.0.0.1:1", true, parse_cars)
            .await
            .unwrap();
        assert_eq!(status, "stale");
        assert_eq!(v, value);
    }
    #[tokio::test]
    #[ignore]
    async fn live_reports_for_cars_and_tungsten() {
        let root = std::env::temp_dir().join(format!("ge-trackers-live-{}", uuid::Uuid::new_v4()));
        let q = Query {
            domain: "cars".into(),
            subject: "".into(),
            month: "2026-09".into(),
            segment: "all".into(),
        };
        let r = report(&root, q, true).await.unwrap();
        println!(
            "cars subjects={} series={} sources={}",
            r.subjects.len(),
            r.series.len(),
            r.sources.len()
        );
        for s in &r.sources {
            println!("{} {} {}", s.name, s.status, s.message);
        }
        assert!(r
            .series
            .iter()
            .any(|s| s.id.starts_with("sales-") && s.points.len() >= 6));
        assert!(r
            .series
            .iter()
            .any(|s| s.id.starts_with("price-") && s.points.len() == 1));
        let q = Query {
            domain: "metals".into(),
            subject: "APT".into(),
            month: "2026-09".into(),
            segment: "all".into(),
        };
        let r = report(&root, q, true).await.unwrap();
        for s in &r.sources {
            println!("{} {} {}", s.name, s.status, s.message);
        }
        assert!(r
            .series
            .iter()
            .any(|s| s.id == "APT-low" && !s.points.is_empty()));
        println!("tungsten {} points", r.series[0].points.len());
        for id in ["AG0", "CU0", "AL0", "LC0", "ZN0", "PB0", "NI0", "SN0"] {
            let q = Query {
                domain: "metals".into(),
                subject: id.into(),
                month: "2026-09".into(),
                segment: "all".into(),
            };
            let r = report(&root, q, true).await.unwrap();
            assert!(r.series.iter().any(|s| s.points.len() > 100), "{id}");
            println!(
                "{id}: {} points, {}",
                r.series[0].points.len(),
                r.series[0].unit
            );
        }
    }
    #[test]
    fn full_car_api_validates_month_and_scope_metadata() {
        let text = include_str!("tracker-fixtures/car-api.json");
        let value = parse_car_api(text).unwrap();
        assert_eq!(value["month"], "2026-09");
        assert_eq!(value["segment"], "0");
        assert_eq!(value["rows"][0]["sales"], 50359.0);
        let mut raw: Value = serde_json::from_str(text).unwrap();
        raw["result"]["pagecount"] = json!(11);
        assert!(parse_car_api(&raw.to_string()).is_err());
        let mut raw: Value = serde_json::from_str(text).unwrap();
        raw["result"]["list"][1]["shareinfo"]["shareext"] = json!(
            "{\"date\":\"2026-08\",\"seriesid\":\"7806\",\"typeid\":\"1\",\"subranktypeid\":\"1\"}"
        );
        assert!(parse_car_api(&raw.to_string()).is_err());
        assert!(car_api_url("2026-02", "all").contains("pagesize=1000"));
    }
    #[tokio::test]
    #[ignore]
    async fn live_full_car_history() {
        let root = std::env::temp_dir().join(format!("ge-full-cars-{}", uuid::Uuid::new_v4()));
        let q = Query {
            domain: "cars".into(),
            subject: "".into(),
            month: "2026-09".into(),
            segment: "all".into(),
        };
        let r = report(&root, q, true).await.unwrap();
        for source in &r.sources {
            println!("{} {} {}", source.name, source.status, source.message);
        }
        println!("subjects {}", r.subjects.len());
        assert!(r.subjects.len() > 500);
        let model = r.series.iter().find(|s| s.id == "sales-5769").unwrap();
        println!("Model Y months: {}", model.points.len());
        assert!(model.points.len() >= 12);
        for series in r.series.iter().filter(|s| {
            s.id.starts_with("sales-")
                && s.points
                    .iter()
                    .any(|p| p.date == "2026-09" && p.value == 14577.0)
        }) {
            println!(
                "screenshot model {}: {} months",
                series.subject,
                series.points.len()
            );
            assert!(series.points.len() < 12);
            assert_eq!(series.points.last().unwrap().date, "2026-09");
        }
    }
    #[tokio::test]
    async fn full_month_collects_all_pages_and_preserves_provenance() {
        let root = std::env::temp_dir().join(format!("ge-car-pages-{}", uuid::Uuid::new_v4()));
        for page in 1..=2 {
            let value = json!({"month":"2026-09","type":"1","subtype":"1","segment":"0","pages":2,"page":page,"priceDate":"2026-10-18","rows":[{"id":page.to_string(),"name":format!("car {page}"),"sales":100,"price":"10万"}]});
            write(
                &root.join(format!("cache/cars-full-v3-all-2026-09-{page}.json")),
                &Cache {
                    time: Utc::now().timestamp(),
                    value,
                },
            )
            .unwrap();
        }
        let (value, status, _) = fetch_car_month(&root, "2026-09", "all", false)
            .await
            .unwrap();
        assert_eq!(status, "cached");
        assert_eq!(value["rows"].as_array().unwrap().len(), 2);
        assert!(value["rows"][1]["sourceUrl"]
            .as_str()
            .unwrap()
            .contains("pageindex=2"));
        assert_eq!(value["rows"][1]["priceDate"], "2026-10-18");
        let p = root.join("cache/cars-full-v3-all-2026-09-2.json");
        let mut cache: Cache = serde_json::from_slice(&fs::read(&p).unwrap()).unwrap();
        cache.value["month"] = json!("2026-08");
        write(&p, &cache).unwrap();
        assert!(fetch_car_month(&root, "2026-09", "all", false)
            .await
            .is_err());
    }
}
