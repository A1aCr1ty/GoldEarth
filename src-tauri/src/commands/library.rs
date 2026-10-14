use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::models::{LibraryCategory, LibraryFile};
use crate::AppState;

fn state_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// 分类 + 文件数：左侧列表一次拿全，不用为每个分类再问一次
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCategoryView {
    #[serde(flatten)]
    pub category: LibraryCategory,
    pub file_count: usize,
}

impl LibraryCategoryView {
    fn new(category: LibraryCategory, file_count: usize) -> Self {
        Self { category, file_count }
    }
}

#[derive(Debug, Deserialize)]
pub struct LibraryCategoryInput {
    pub name: String,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub description: String,
}

/// 知识库分类列表（含各自的资料数量）
#[tauri::command]
pub fn list_library_categories(state: State<'_, AppState>) -> Result<Vec<LibraryCategoryView>, String> {
    let library = state.storage.library();
    Ok(library
        .list_categories()
        .into_iter()
        .map(|c| {
            let count = library.file_count(&c.id);
            LibraryCategoryView::new(c, count)
        })
        .collect())
}

/// 新建分类：同时建好它的目录，之后导入的资料都放这里
#[tauri::command]
pub fn create_library_category(
    state: State<'_, AppState>,
    input: LibraryCategoryInput,
) -> Result<LibraryCategoryView, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("分类名称不能为空".into());
    }
    let now = crate::db::now_iso();
    let category = LibraryCategory {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        agent_id: input.agent_id.trim().to_string(),
        description: input.description.trim().to_string(),
        created_at: now.clone(),
        updated_at: now,
    };
    let created = state.storage.library().insert_category(category).map_err(state_err)?;
    Ok(LibraryCategoryView::new(created, 0))
}

/// 改分类：改名会连目录一起搬，里面的资料跟着走
#[tauri::command]
pub fn update_library_category(
    state: State<'_, AppState>,
    id: String,
    input: LibraryCategoryInput,
) -> Result<LibraryCategoryView, String> {
    let library = state.storage.library();
    let updated = library
        .update_category(
            &id,
            Some(input.name),
            Some(input.agent_id),
            Some(input.description),
        )
        .map_err(state_err)?;
    let count = library.file_count(&id);
    Ok(LibraryCategoryView::new(updated, count))
}

/// 只改分类绑定的 agent（列表里直接下拉切换时用）
#[tauri::command]
pub fn set_library_category_agent(
    state: State<'_, AppState>,
    id: String,
    agent_id: String,
) -> Result<LibraryCategoryView, String> {
    let library = state.storage.library();
    let updated = library
        .update_category(&id, None, Some(agent_id), None)
        .map_err(state_err)?;
    let count = library.file_count(&id);
    Ok(LibraryCategoryView::new(updated, count))
}

/// 删分类：目录里的资料一并删除（前端会先让用户确认）
#[tauri::command]
pub fn delete_library_category(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.storage.library().delete_category(&id).map_err(state_err)
}

/// 分类下收的资料
#[tauri::command]
pub fn list_library_files(state: State<'_, AppState>, category_id: String) -> Result<Vec<LibraryFile>, String> {
    Ok(state.storage.library().list_files(&category_id))
}

/// 把外部文件拷进分类目录（前端用文件选择器拿到绝对路径）
#[tauri::command]
pub fn import_library_files(
    state: State<'_, AppState>,
    category_id: String,
    sources: Vec<String>,
) -> Result<Vec<LibraryFile>, String> {
    if sources.is_empty() {
        return Ok(state.storage.library().list_files(&category_id));
    }
    state
        .storage
        .library()
        .import_files(&category_id, &sources)
        .map_err(state_err)
}

/// 从知识库移除一个文件
#[tauri::command]
pub fn delete_library_file(
    state: State<'_, AppState>,
    category_id: String,
    name: String,
) -> Result<Vec<LibraryFile>, String> {
    state
        .storage
        .library()
        .delete_file(&category_id, &name)
        .map_err(state_err)?;
    Ok(state.storage.library().list_files(&category_id))
}

/// 文本类资料的预览内容；二进制返回 null
#[tauri::command]
pub fn read_library_text(
    state: State<'_, AppState>,
    category_id: String,
    name: String,
) -> Result<Option<String>, String> {
    state
        .storage
        .library()
        .read_text(&category_id, &name)
        .map_err(state_err)
}

/// 分类目录的绝对路径，界面上显示给用户看（也方便手动往里丢文件）
#[tauri::command]
pub fn library_category_path(state: State<'_, AppState>, id: String) -> Result<Option<String>, String> {
    Ok(state
        .storage
        .library()
        .existing_category_dir(&id)
        .map(|p| p.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn category(id: &str) -> LibraryCategory {
        LibraryCategory {
            id: id.into(),
            name: "资料".into(),
            agent_id: "a1".into(),
            description: String::new(),
            created_at: crate::db::now_iso(),
            updated_at: crate::db::now_iso(),
        }
    }

    #[test]
    fn view_flattens_category_and_adds_file_count() {
        let v = serde_json::to_value(LibraryCategoryView::new(category("c1"), 7)).unwrap();
        // flatten：前端拿到的是一层平铺的对象
        assert_eq!(v["id"], "c1");
        assert_eq!(v["agentId"], "a1");
        assert_eq!(v["fileCount"], 7);
        assert!(v.get("category").is_none(), "不该再包一层 category");
    }
}