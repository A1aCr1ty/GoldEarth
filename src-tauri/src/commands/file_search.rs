//! Self-contained filename search over an immutable in-process index.
//! Queries never walk the disk or invoke external search programs.
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::Instant,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    path: String,
    name: String,
    is_dir: bool,
    #[serde(skip)]
    key: String,
    #[serde(skip)]
    name_key: String,
}
#[derive(Default)]
struct Index {
    entries: Arc<Vec<Entry>>,
    grams: Arc<HashMap<[u8; 3], Vec<usize>>>,
    root: String,
    skipped: usize,
    updated: Option<String>,
}

// Each filename contributes a posting only once per byte trigram. Picking the
// shortest posting avoids scanning every filename for selective queries. UTF-8
// byte grams remain lossless because candidates are checked with str::contains.
fn build_grams(entries: &[Entry]) -> HashMap<[u8; 3], Vec<usize>> {
    let mut grams: HashMap<[u8; 3], Vec<usize>> = HashMap::new();
    for (id, e) in entries.iter().enumerate() {
        let mut keys: Vec<[u8; 3]> = e
            .name_key
            .as_bytes()
            .windows(3)
            .map(|w| [w[0], w[1], w[2]])
            .collect();
        keys.sort_unstable();
        keys.dedup();
        for key in keys {
            grams.entry(key).or_default().push(id);
        }
    }
    grams
}

fn candidates<'a>(
    grams: &'a HashMap<[u8; 3], Vec<usize>>,
    terms: &[String],
) -> Option<&'a [usize]> {
    let mut best: Option<&[usize]> = None;
    for t in terms.iter().filter(|t| !t.starts_with("ext:")) {
        for w in t.as_bytes().windows(3) {
            let Some(ids) = grams.get(&[w[0], w[1], w[2]]) else {
                return Some(&[]);
            };
            if best.map_or(true, |b| ids.len() < b.len()) {
                best = Some(ids);
            }
        }
    }
    best
}
static INDEX: Lazy<RwLock<Index>> = Lazy::new(|| RwLock::new(Index::default()));
static BUILDING: AtomicBool = AtomicBool::new(false);
static PROGRESS: AtomicUsize = AtomicUsize::new(0);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    building: bool,
    indexed: usize,
    progress: usize,
    root: String,
    skipped: usize,
    updated: Option<String>,
}

#[tauri::command]
pub fn file_search_status() -> Status {
    let i = INDEX.read();
    Status {
        building: BUILDING.load(Ordering::Acquire),
        indexed: i.entries.len(),
        progress: PROGRESS.load(Ordering::Relaxed),
        root: i.root.clone(),
        skipped: i.skipped,
        updated: i.updated.clone(),
    }
}

fn entry(path: PathBuf, is_dir: bool) -> Entry {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let path = path.to_string_lossy().into_owned();
    Entry {
        key: path.to_lowercase(),
        name_key: name.to_lowercase(),
        path,
        name,
        is_dir,
    }
}

fn scan(root: &Path) -> (Vec<Entry>, usize) {
    let mut stack = vec![root.to_path_buf()];
    let mut entries = Vec::new();
    let mut skipped = 0;
    while let Some(dir) = stack.pop() {
        let children = match std::fs::read_dir(dir) {
            Ok(c) => c,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        for child in children {
            let child = match child {
                Ok(c) => c,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            let ty = match child.file_type() {
                Ok(t) => t,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            // Junctions and symlinks must not escape the selected root or form cycles.
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if child
                    .metadata()
                    .map(|m| m.file_attributes() & 0x400 != 0)
                    .unwrap_or(true)
                {
                    skipped += 1;
                    continue;
                }
            }
            if ty.is_symlink() {
                skipped += 1;
                continue;
            }
            if ty.is_dir() {
                stack.push(child.path());
            }
            entries.push(entry(child.path(), ty.is_dir()));
        }
        PROGRESS.store(entries.len(), Ordering::Relaxed);
    }
    entries.sort_unstable_by(|a, b| a.name_key.cmp(&b.name_key).then(a.key.cmp(&b.key)));
    (entries, skipped)
}

#[tauri::command]
pub fn file_search_index(root: String) -> Result<(), String> {
    let root = PathBuf::from(root);
    if !root.is_absolute() || !root.is_dir() {
        return Err("请选择有效的绝对目录路径".into());
    }
    if BUILDING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("索引正在构建，请等待完成".into());
    }
    PROGRESS.store(0, Ordering::Relaxed);
    std::thread::spawn(move || {
        struct Reset;
        impl Drop for Reset {
            fn drop(&mut self) {
                BUILDING.store(false, Ordering::Release);
            }
        }
        let _reset = Reset;
        let (entries, skipped) = scan(&root);
        let grams = Arc::new(build_grams(&entries));
        *INDEX.write() = Index {
            entries: Arc::new(entries),
            grams,
            root: root.to_string_lossy().into_owned(),
            skipped,
            updated: Some(chrono::Local::now().to_rfc3339()),
        };
    });
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Results {
    items: Vec<Entry>,
    has_more: bool,
    total: usize,
    elapsed_ms: f64,
}

fn matches(e: &Entry, terms: &[String], kind: &str, full_path: bool) -> bool {
    if (kind == "folder" && !e.is_dir) || (kind == "file" && e.is_dir) {
        return false;
    }
    terms.iter().all(|t| {
        if let Some(ext) = t.strip_prefix("ext:") {
            !e.is_dir
                && ext
                    .split(';')
                    .any(|x| Path::new(&e.name_key).extension().is_some_and(|e| e == x))
        } else {
            (if full_path { &e.key } else { &e.name_key }).contains(t)
        }
    })
}

#[tauri::command]
pub async fn file_search_query(
    query: String,
    kind: String,
    full_path: bool,
    offset: usize,
) -> Result<Results, String> {
    if query.len() > 4096 || offset > 1_000_000 {
        return Err("搜索条件超出限制".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let start = Instant::now();
        let (entries, grams) = {
            let i = INDEX.read();
            (i.entries.clone(), i.grams.clone())
        };
        let terms: Vec<_> = query.split_whitespace().map(str::to_lowercase).collect();
        let mut items = Vec::new();
        let mut total = 0;
        let ids = if full_path {
            None
        } else {
            candidates(&grams, &terms)
        };
        let iter: Box<dyn Iterator<Item = &Entry>> = match ids {
            Some(ids) => Box::new(ids.iter().map(|&id| &entries[id])),
            None => Box::new(entries.iter()),
        };
        for e in iter.filter(|e| matches(e, &terms, &kind, full_path)) {
            if total >= offset && items.len() < 100 {
                items.push(e.clone());
            }
            total += 1;
        }
        Ok(Results {
            items,
            has_more: total > offset + 100,
            total,
            elapsed_ms: start.elapsed().as_secs_f64() * 1000.0,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn file_search_reveal(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_absolute() || !p.exists() {
        return Err("文件已移动、删除或无法访问".into());
    }
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(format!("/select,{path}"))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("当前仅支持 Windows 文件定位".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn indexed_candidates_equal_linear_search() {
        let entries: Vec<_> = (0..10_000)
            .map(|n| entry(PathBuf::from(format!("/资料/报告{n:05}.PDF")), false))
            .collect();
        let grams = build_grams(&entries);
        for query in ["报告000", "pdf", "报告 00001", "不存在", "ext:pdf", "0", ""] {
            let terms: Vec<_> = query.split_whitespace().map(str::to_lowercase).collect();
            let expected: Vec<_> = entries
                .iter()
                .enumerate()
                .filter(|(_, e)| matches(e, &terms, "all", false))
                .map(|(id, _)| id)
                .collect();
            let ids: Vec<_> = candidates(&grams, &terms)
                .map(|ids| ids.to_vec())
                .unwrap_or_else(|| (0..entries.len()).collect());
            let actual: Vec<_> = ids
                .into_iter()
                .filter(|&id| matches(&entries[id], &terms, "all", false))
                .collect();
            assert_eq!(actual, expected, "{query}");
        }
    }

    #[test]
    fn selective_query_benchmark() {
        let entries: Vec<_> = (0..100_000)
            .map(|n| entry(PathBuf::from(format!("/data/report-{n:06}.txt")), false))
            .collect();
        let grams = build_grams(&entries);
        let terms = vec!["report-057123".to_string()];
        let start = Instant::now();
        let ids = candidates(&grams, &terms).unwrap();
        let found = ids
            .iter()
            .filter(|&&id| matches(&entries[id], &terms, "file", false))
            .count();
        println!(
            "100k synthetic filenames: {} candidates, {} match, {:.3} ms (debug, query only)",
            ids.len(),
            found,
            start.elapsed().as_secs_f64() * 1000.0
        );
        assert_eq!(found, 1);
        assert!(ids.len() < 1000);
    }
    #[test]
    fn unicode_extensions_and_path() {
        let e = entry(PathBuf::from("/资料/年度报告.PDF"), false);
        assert!(matches(
            &e,
            &["年度".into(), "ext:pdf;docx".into()],
            "file",
            false
        ));
        assert!(!matches(&e, &["资料".into()], "all", false));
        assert!(matches(&e, &["资料".into()], "all", true));
        assert!(!matches(&e, &[], "folder", true));
    }
    #[test]
    fn scan_refresh_removes_deleted_files() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(dir.join("子目录")).unwrap();
        let file = dir.join("子目录/中文.txt");
        std::fs::write(&file, "hello").unwrap();
        assert_eq!(scan(&dir).0.len(), 2);
        std::fs::remove_file(file).unwrap();
        assert_eq!(scan(&dir).0.len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
