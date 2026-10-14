use serde::Deserialize;
use tauri::State;

use crate::AppState;
use crate::agents;
use crate::db::{now_iso, models::{Agent, AgentKind, AgentRun, AgentRunStatus}};

fn state_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

#[tauri::command]
pub fn list_agents(state: State<'_, AppState>) -> Result<Vec<Agent>, String> {
    Ok(state.storage.list_agents())
}

#[derive(Debug, Deserialize)]
pub struct AgentInput {
    pub name: String,
    pub kind: AgentKind,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool { true }

#[tauri::command]
pub fn create_agent(state: State<'_, AppState>, input: AgentInput) -> Result<Agent, String> {
    let agent = Agent {
        id: uuid::Uuid::new_v4().to_string(),
        name: input.name,
        kind: input.kind,
        command: input.command,
        args: input.args,
        description: input.description,
        enabled: input.enabled,
        created_at: now_iso(),
    };
    state.storage.insert_agent(agent).map_err(state_err)
}

#[tauri::command]
pub fn update_agent(state: State<'_, AppState>, id: String, input: AgentInput) -> Result<Agent, String> {
    state
        .storage
        .update_agent(
            &id,
            Some(input.name),
            Some(input.kind),
            Some(input.command),
            Some(input.args),
            input.description,
            Some(input.enabled),
        )
        .map_err(state_err)
}

#[tauri::command]
pub fn delete_agent(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.storage.delete_agent(&id).map_err(state_err)
}

#[tauri::command]
pub fn run_agent(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    agent_id: String,
    prompt: String,
    session_id: Option<String>,
    note_id: Option<String>,
    stock_code: Option<String>,
    library_id: Option<String>,
    context: Option<String>,
) -> Result<AgentRun, String> {
    let agent = state.storage.get_agent(&agent_id).map_err(state_err)?;
    if !agent.enabled {
        return Err("agent is disabled".into());
    }
    let run_id = uuid::Uuid::new_v4().to_string();
    let record = AgentRun {
        id: run_id.clone(),
        agent_id: agent_id.clone(),
        prompt: prompt.clone(),
        status: AgentRunStatus::Running,
        output: String::new(),
        error: None,
        started_at: now_iso(),
        finished_at: None,
        session_id: session_id.filter(|s| !s.is_empty()),
        note_id: note_id.filter(|s| !s.is_empty()),
        stock_code: stock_code
            .filter(|s| !s.is_empty())
            .map(|c| crate::market::symbol::normalize(&c)),
        library_id: library_id.filter(|s| !s.is_empty()),
    };
    let stored = state.storage.insert_run(record).map_err(state_err)?;
    let storage = state.storage.clone();
    let runs = state.runs.clone();
    let bin_path = state.storage.settings().agent_bin_path;
    // 工作目录决定 agent 能直接看到什么：
    // - 知识库分类：就进这个分类的目录，它读到的自然只有这一类资料；
    // - 其余（笔记 / 股票 / Agent 页）：还是笔记仓库 vault。
    let work_dir = match stored.library_id.as_deref() {
        Some(id) => state
            .storage
            .library()
            .existing_category_dir(id)
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| state.storage.vault_root().display().to_string()),
        None => state.storage.vault_root().display().to_string(),
    };
    agents::spawn_run(
        app,
        storage,
        runs,
        run_id,
        agent,
        stored.clone(),
        bin_path,
        work_dir,
        context,
        |_finished| { /* completion handled by storage update */ },
    );
    Ok(stored)
}

#[tauri::command]
pub fn cancel_agent_run(state: State<'_, AppState>, run_id: String) -> Result<(), String> {
    let mut reg = state.runs.lock();
    if reg.cancel(&run_id) {
        Ok(())
    } else {
        Err("no such running agent".into())
    }
}

#[tauri::command]
pub fn list_agent_runs(state: State<'_, AppState>, limit: Option<usize>) -> Result<Vec<AgentRun>, String> {
    Ok(state.storage.list_runs(limit.unwrap_or(50)))
}

/// 某篇笔记与某个 agent 的对话历史（最新在前），笔记页用它还原聊天记录
#[tauri::command]
pub fn list_note_runs(
    state: State<'_, AppState>,
    note_id: String,
    agent_id: String,
    limit: Option<usize>,
) -> Result<Vec<AgentRun>, String> {
    Ok(state
        .storage
        .list_runs_for_scope(&note_id, &agent_id, limit.unwrap_or(100)))
}

/// 某只股票与某个 agent 的对话历史（最新在前），股票看板用它还原分析记录
#[tauri::command]
pub fn list_stock_runs(
    state: State<'_, AppState>,
    stock_code: String,
    agent_id: String,
    limit: Option<usize>,
) -> Result<Vec<AgentRun>, String> {
    let code = crate::market::symbol::normalize(&stock_code);
    Ok(state
        .storage
        .list_runs_for_scope(&code, &agent_id, limit.unwrap_or(100)))
}

/// 某篇笔记与某个 agent 上一次留下的会话 ID，用来 resume 接着聊。
/// 没有就返回 null，前端会当成新会话开始。
#[tauri::command]
pub fn get_note_agent_session(
    state: State<'_, AppState>,
    note_id: String,
    agent_id: String,
) -> Result<Option<String>, String> {
    Ok(state.storage.latest_session_for(&agent_id, &note_id))
}

/// 某只股票与某个 agent 上一次留下的会话 ID
#[tauri::command]
pub fn get_stock_agent_session(
    state: State<'_, AppState>,
    stock_code: String,
    agent_id: String,
) -> Result<Option<String>, String> {
    let code = crate::market::symbol::normalize(&stock_code);
    Ok(state.storage.latest_session_for(&agent_id, &code))
}

/// 某个知识库分类与某个 agent 的对话历史（最新在前）
#[tauri::command]
pub fn list_library_runs(
    state: State<'_, AppState>,
    library_id: String,
    agent_id: String,
    limit: Option<usize>,
) -> Result<Vec<AgentRun>, String> {
    Ok(state
        .storage
        .list_runs_for_scope(&library_id, &agent_id, limit.unwrap_or(100)))
}

/// 某个知识库分类与某个 agent 上次留下的会话 ID，用来 resume 接着聊
#[tauri::command]
pub fn get_library_agent_session(
    state: State<'_, AppState>,
    library_id: String,
    agent_id: String,
) -> Result<Option<String>, String> {
    Ok(state.storage.latest_session_for(&agent_id, &library_id))
}

/// 分类目录的绝对路径，发给 Agent 让它知道资料在哪
#[tauri::command]
pub fn get_library_dir(state: State<'_, AppState>, id: String) -> Result<Option<String>, String> {
    Ok(state
        .storage
        .library()
        .existing_category_dir(&id)
        .map(|p| p.display().to_string()))
}

/// 笔记在 vault 里的相对路径，发给 Agent 让它知道该改哪个文件
#[tauri::command]
pub fn get_note_file_path(state: State<'_, AppState>, id: String) -> Result<Option<String>, String> {
    Ok(state.storage.relative_note_path(&id))
}
