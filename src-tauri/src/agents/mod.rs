use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::oneshot;

use crate::db::models::{Agent, AgentRun, AgentRunStatus};

/// Agent 逐段吐出回复时发出的事件，前端据此把「跑完才有结果」变成实时对话
pub const STREAM_EVENT: &str = "agent://stream";
/// 运行结束（含失败/取消）时发出，payload 是最终的运行记录
pub const DONE_EVENT: &str = "agent://done";

/// 流式事件的载荷
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub run_id: String,
    pub agent_id: String,
    pub note_id: Option<String>,
    /// 知识库对话：这轮是哪个分类发起的
    pub library_id: Option<String>,
    /// 相对已发出内容的增量，前端直接追加即可
    pub text: String,
}

/// Windows 上 `CreateProcess` 查 PATH 时只补 `.exe` 后缀，而 npm 全局安装的 CLI
/// （codex / claude / openai 等）落地的是 `.cmd` / `.bat` shim，直接 spawn 会报
/// "program not found"。这里按 PATHEXT 自行解析出真实可执行文件。
#[cfg(windows)]
fn resolve_program(program: &str, bin_path: Option<&str>) -> PathBuf {
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());

    // 设置里显式配置的地址优先：文件直接用，目录则只在这里找
    if let Some(bp) = bin_path.map(str::trim).filter(|s| !s.is_empty()) {
        let configured = PathBuf::from(bp);
        if configured.is_file() {
            return configured;
        }
        if configured.is_dir() {
            for ext in exts.split(';').filter(|e| !e.is_empty()) {
                let c = configured.join(format!("{program}{ext}"));
                if c.is_file() {
                    return c;
                }
            }
            let bare = configured.join(program);
            if bare.is_file() {
                return bare;
            }
        }
    }

    let direct = PathBuf::from(program);
    // 写死了路径（含分隔符）或本来就是文件，直接用
    if program.contains('\\') || program.contains('/') || direct.is_file() {
        return direct;
    }
    let path = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        // 先按 PATHEXT 找：npm 全局 CLI 目录里往往还有一个无扩展名的
        // bash shim（就叫 `codex`），在 Windows 上压根跑不起来，
        // 若先按裸名匹配就会拿到它并撞上 os error 193。
        for ext in exts.split(';').filter(|e| !e.is_empty()) {
            let candidate = dir.join(format!("{program}{ext}"));
            if candidate.is_file() {
                return candidate;
            }
        }
        // 少数无扩展名的可执行文件放到最后兜底
        let bare = dir.join(program);
        if bare.is_file() {
            return bare;
        }
    }
    direct
}

#[cfg(not(windows))]
fn resolve_program(program: &str, bin_path: Option<&str>) -> PathBuf {
    if let Some(bp) = bin_path.map(str::trim).filter(|s| !s.is_empty()) {
        let configured = PathBuf::from(bp);
        if configured.is_file() {
            return configured;
        }
        if configured.is_dir() {
            let c = configured.join(program);
            if c.is_file() {
                return c;
            }
        }
    }
    PathBuf::from(program)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn resolves_bare_name_to_real_file() {
        // cmd 在 System32 且只有 .exe，Rust 原生就能找到；这里确认解析结果可用
        let resolved = resolve_program("cmd", None);
        assert!(resolved.is_file(), "cmd 未能解析到真实文件: {resolved:?}");
    }

    #[test]
    fn keeps_explicit_path_untouched() {
        // 写了路径分隔符就不再搜 PATH，原样交给 spawn
        let explicit = PathBuf::from("tools\\bin\\mycli.exe");
        assert_eq!(resolve_program(r"tools\bin\mycli.exe", None), explicit);
    }

    #[test]
    fn resolves_npm_cmd_shim_when_installed() {
        // npm 全局 CLI 落地的是 codex.cmd，没有 codex.exe，
        // 这正是原先 spawn 报 "program not found" 的原因
        let installed = std::process::Command::new("cmd")
            .args(["/c", "where", "codex"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !installed {
            eprintln!("codex 未安装，跳过该用例");
            return;
        }
        let resolved = resolve_program("codex", None);
        assert!(
            resolved.is_file(),
            "codex 未能解析到可执行文件: {resolved:?}"
        );
    }

    #[tokio::test]
    async fn spawns_npm_cmd_shim_without_os_error_193() {
        let installed = std::process::Command::new("cmd")
            .args(["/c", "where", "codex"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !installed {
            eprintln!("codex 未安装，跳过该用例");
            return;
        }
        let agent = Agent {
            id: "a1".into(),
            name: "codex".into(),
            kind: crate::db::models::AgentKind::Codex,
            command: "codex".into(),
            args: vec!["--version".into()],
            description: None,
            enabled: true,
            created_at: String::new(),
        };
        let mut cmd = build_command(&agent, "", None, None);
        let output = cmd
            .output()
            .await
            .expect("spawn 失败——多半是又退回了 os error 193");
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            stdout.contains("codex-cli"),
            "期望读到 codex 版本号，实际输出: {stdout:?} / stderr: {:?}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[tokio::test]
    async fn batch_shim_preserves_prompt_metacharacters() {
        // 经 cmd.exe 转发给 node，用 JSON 回读 argv，确认 prompt 原样送达
        let dir = std::env::temp_dir().join("ge_batch_arg_test");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("forward.cmd"),
            "@echo off\r\nnode \"%~dp0print_args.js\" %*\r\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("print_args.js"),
            "require('fs').writeFileSync(__dirname + '/out.json', JSON.stringify(process.argv.slice(2)));\n",
        )
        .unwrap();

        let tricky = "a & b < c > d | e ^ f \"g\" 100% 日常事务处理";
        let agent = Agent {
            id: "a1".into(),
            name: "t".into(),
            kind: crate::db::models::AgentKind::Custom,
            command: dir.join("forward.cmd").to_string_lossy().to_string(),
            args: vec!["--prompt".into()],
            description: None,
            enabled: true,
            created_at: String::new(),
        };
        let mut cmd = build_command(&agent, tricky, None, None);
        let output = cmd.output().await.expect("spawn 失败");
        assert!(
            output.status.success(),
            "运行失败: {:?}",
            String::from_utf8_lossy(&output.stderr)
        );

        let raw = std::fs::read_to_string(dir.join("out.json")).expect("未生成 out.json");
        let received: Vec<String> = serde_json::from_str(&raw).unwrap();
        assert_eq!(received, vec!["--prompt".to_string(), tricky.to_string()]);
    }

    #[test]
    fn parses_codex_jsonl_for_reply_and_session_id() {
        let raw = concat!(
            r#"{"type":"thread.started","thread_id":"01a13491-b6c8-7f23-8a00-eb51b97f9004"}"#,
            "\n",
            r#"{"type":"item.completed","item":{"id":"item_0","type":"error","message":"配置有误"}}"#,
            "\n",
            r#"{"type":"turn.started"}"#,
            "\n",
            r#"{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"已经帮你建好笔记"}}"#,
            "\n",
            r#"{"type":"turn.completed","usage":{"input_tokens":1}}"#,
            "\n"
        );
        let out = super::parse_codex_output(raw);
        assert_eq!(
            out.session_id.as_deref(),
            Some("01a13491-b6c8-7f23-8a00-eb51b97f9004")
        );
        assert_eq!(out.messages, vec!["已经帮你建好笔记".to_string()]);
        assert_eq!(out.errors, vec!["配置有误".to_string()]);
    }

    #[test]
    fn falls_back_to_plain_output_without_json() {
        let out = super::parse_codex_output("普通一行输出\n另一行\n");
        assert_eq!(out.messages.len(), 2);
        assert!(out.session_id.is_none());
    }

    #[test]
    fn partial_events_do_not_repeat_in_final_output() {
        // codex 先吐增量再吐完整消息，最终输出里只能留完整的那条
        let raw = concat!(
            r#"{"type":"item.updated","item":{"id":"item_3","type":"agent_message","text":"已经帮"}}"#,
            "\n",
            r#"{"type":"item.updated","item":{"id":"item_3","type":"agent_message","text":"已经帮你建好笔记"}}"#,
            "\n",
            r#"{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"已经帮你建好笔记"}}"#,
            "\n"
        );
        let out = super::parse_codex_output(raw);
        assert_eq!(out.messages, vec!["已经帮你建好笔记".to_string()]);
    }

    #[test]
    fn reply_stream_emits_only_the_new_part() {
        let mut stream = super::ReplyStream::default();

        // 增量片段：逐段追加
        let delta = super::parse_codex_line(
            r#"{"type":"item.updated","item":{"type":"agent_message","text":"已"}}"#,
        );
        assert_eq!(stream.push(&delta).as_deref(), Some("已"));
        let delta = super::parse_codex_line(
            r#"{"type":"item.updated","item":{"type":"agent_message","text":"经改好了"}}"#,
        );
        assert_eq!(stream.push(&delta).as_deref(), Some("经改好了"));

        // 随后到达的完整消息已经全发出过，不该重复推给前端
        let full = super::parse_codex_line(
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"已经改好了"}}"#,
        );
        assert_eq!(stream.push(&full), None, "重复的完整消息不应再次推送");

        // 换一条新消息时整段重发，前端追加后内容仍然完整
        let next = super::parse_codex_line(
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"还要补充标签吗"}}"#,
        );
        assert_eq!(stream.push(&next).as_deref(), Some("还要补充标签吗"));

        // 普通输出每行都是独立消息，按行追加
        let plain = super::parse_codex_line("done");
        assert_eq!(stream.push(&plain).as_deref(), Some("done\n"));
    }

    #[test]
    fn reply_stream_handles_cumulative_full_messages() {
        let mut stream = super::ReplyStream::default();
        let first = super::parse_codex_line(
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"第一段"}}"#,
        );
        assert_eq!(stream.push(&first).as_deref(), Some("第一段"));
        // 同一轮的完整消息是全量重发，只补发多出来的部分
        let grown = super::parse_codex_line(
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"第一段继续"}}"#,
        );
        assert_eq!(stream.push(&grown).as_deref(), Some("继续"));
    }

    #[test]
    fn codex_agent_gets_required_flags_but_custom_does_not() {
        let mut agent = Agent {
            id: "a1".into(),
            name: "c".into(),
            kind: crate::db::models::AgentKind::Codex,
            command: "codex".into(),
            args: vec!["exec".into()],
            description: None,
            enabled: true,
            created_at: String::new(),
        };
        let cmd = super::build_command(&agent, "MARKER_PROMPT", None, None);
        let rendered = format!("{:?}", cmd.as_std().get_args().collect::<Vec<_>>());
        assert!(
            rendered.contains("--json"),
            "codex 应自动带上 --json: {rendered}"
        );
        assert!(
            rendered.contains("--skip-git-repo-check"),
            "codex 应自动带上 --skip-git-repo-check: {rendered}"
        );
        // prompt 是位置参数，必须排在开关后面
        let flag_at = rendered.find("--skip-git-repo-check").expect("开关丢失");
        let prompt_at = rendered.find("MARKER_PROMPT").expect("prompt 丢失");
        assert!(flag_at < prompt_at, "开关应排在 prompt 之前: {rendered}");

        agent.kind = crate::db::models::AgentKind::Custom;
        let cmd = super::build_command(&agent, "MARKER_PROMPT", None, None);
        let rendered = format!("{:?}", cmd.as_std().get_args().collect::<Vec<_>>());
        assert!(
            !rendered.contains("--json"),
            "自定义 agent 不应被强加 --json: {rendered}"
        );
        assert!(
            !rendered.contains("--skip-git-repo-check"),
            "自定义 agent 不应被强加 --skip-git-repo-check: {rendered}"
        );
    }

    #[test]
    fn codex_flags_land_before_positional_args() {
        // 续话参数形如 exec resume --json <SESSION_ID>，开关不能插到 session id 后面
        let mut args: Vec<String> = vec![
            "exec".into(),
            "resume".into(),
            "--json".into(),
            "01a13491-b6c8-7f23-8a00-eb51b97f9004".into(),
        ];
        super::ensure_codex_flags(&mut args);
        assert_eq!(
            args,
            vec![
                "exec".to_string(),
                "resume".to_string(),
                "--skip-git-repo-check".to_string(),
                "--json".to_string(),
                "01a13491-b6c8-7f23-8a00-eb51b97f9004".to_string(),
            ]
        );
        // 重复调用不应叠加
        super::ensure_codex_flags(&mut args);
        assert_eq!(args.len(), 5, "重复补齐不应重复插入: {args:?}");
    }

    #[test]
    fn codex_gets_write_permission_and_workspace_root() {
        // 不补全局开关时 codex 一律以 read-only 启动，Agent 写 .md 会被
        // Windows 沙箱挡成「访问被拒绝」；且这两个开关只认排在 exec 之前的位置。
        let agent = Agent {
            id: "a1".into(),
            name: "c".into(),
            kind: crate::db::models::AgentKind::Codex,
            command: "cmd".into(),
            args: vec!["exec".into()],
            description: None,
            enabled: true,
            created_at: String::new(),
        };
        let dir = std::env::temp_dir();
        // 用 cmd 当程序（不是 .cmd 批处理），这样能直接把 argv 读回来断言
        let cmd = super::build_command(&agent, "你好", None, Some(&dir));
        let argv: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let expected: Vec<String> = [
            "--sandbox",
            "workspace-write",
            "--cd",
            &dir.display().to_string(),
            "exec",
            "--json",
            "--skip-git-repo-check",
            "你好",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(
            argv, expected,
            "全局开关必须排在 exec 之前，且要带上写权限和可写根"
        );
    }

    #[test]
    fn codex_globals_respect_user_specified_ones() {
        let mut args: Vec<String> = vec![
            "-s".into(),
            "danger-full-access".into(),
            "exec".into(),
            "--json".into(),
        ];
        super::ensure_codex_global_args(&mut args, None);
        assert_eq!(
            args,
            vec!["-s", "danger-full-access", "exec", "--json"]
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>(),
            "用户自己指定的沙箱模式不该被覆盖，也不该重复插入: {args:?}"
        );

        // 有工作目录时补 --cd，但重复调用不应叠加
        let dir = std::env::temp_dir();
        let mut args2: Vec<String> = vec!["exec".into()];
        super::ensure_codex_global_args(&mut args2, Some(&dir));
        super::ensure_codex_global_args(&mut args2, Some(&dir));
        assert_eq!(
            args2.iter().filter(|a| *a == "--cd").count(),
            1,
            "--cd 不该重复插入: {args2:?}"
        );
        assert_eq!(
            args2.iter().filter(|a| *a == "--sandbox").count(),
            1,
            "--sandbox 不该重复插入: {args2:?}"
        );
    }

    #[test]
    fn exec_flags_land_after_resume_even_with_globals_in_front() {
        // 续话命令行长这样：全局开关 + exec resume + 开关 + session id + prompt，
        // 开关必须落在 resume 之后、session id 之前。
        let mut args: Vec<String> = vec![
            "--sandbox".into(),
            "workspace-write".into(),
            "--cd".into(),
            "C:\\vault".into(),
            "exec".into(),
            "resume".into(),
            "--json".into(),
            "01a13491-b6c8-7f23-8a00-eb51b97f9004".into(),
        ];
        super::ensure_codex_flags(&mut args);
        let expected: Vec<String> = [
            "--sandbox",
            "workspace-write",
            "--cd",
            "C:\\vault",
            "exec",
            "resume",
            "--skip-git-repo-check",
            "--json",
            "01a13491-b6c8-7f23-8a00-eb51b97f9004",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(args, expected, "开关位置不对: {args:?}");
    }

    #[test]
    fn resume_rewrites_args_with_session_id() {
        // 复刻 spawn_run 里的续话改写逻辑
        let agent = Agent {
            id: "a1".into(),
            name: "c".into(),
            kind: crate::db::models::AgentKind::Codex,
            command: "codex".into(),
            args: vec!["exec".into(), "--skip-git-repo-check".into()],
            description: None,
            enabled: true,
            created_at: String::new(),
        };
        let sid = "01a13491-b6c8-7f23-8a00-eb51b97f9004";
        let mut new_args = vec![
            "exec".to_string(),
            "resume".to_string(),
            "--json".to_string(),
            sid.to_string(),
        ];
        new_args.extend(
            agent
                .args
                .iter()
                .skip(1)
                .filter(|a| *a != "--json")
                .cloned(),
        );
        assert_eq!(
            new_args,
            vec![
                "exec".to_string(),
                "resume".to_string(),
                "--json".to_string(),
                sid.to_string(),
                "--skip-git-repo-check".to_string()
            ]
        );
    }

    #[test]
    fn stream_pump_merges_dense_updates_without_losing_text() {
        // 合并只是换了个发送时机：内容和顺序必须一字不差
        let mut sent: Vec<String> = Vec::new();
        let mut pump = super::StreamPump::default();
        for ch in ["你", "好", "啊"] {
            pump.push(ch.to_string(), &mut |t| sent.push(t));
        }
        pump.flush(&mut |t| sent.push(t));
        assert_eq!(sent.concat(), "你好啊", "合并后内容不能丢: {sent:?}");
        assert!(
            sent.len() <= 2,
            "密集增量应被合并成少数几次发送，实际发了 {} 次: {sent:?}",
            sent.len()
        );
        assert!(
            !sent.iter().any(|s| s.is_empty()),
            "没有待发内容时不该发空事件: {sent:?}"
        );

        // 已经 flush 干净后再 flush 不会产生新事件
        let before = sent.len();
        pump.flush(&mut |t| sent.push(t));
        assert_eq!(sent.len(), before, "空队列不该发事件: {sent:?}");
    }

    #[test]
    fn stream_pump_keeps_order_across_many_chunks() {
        let mut sent = String::new();
        let mut pump = super::StreamPump::default();
        for ch in "沪电股份今天放量突破".chars() {
            pump.push(ch.to_string(), &mut |t| sent.push_str(&t));
        }
        pump.flush(&mut |t| sent.push_str(&t));
        assert_eq!(sent, "沪电股份今天放量突破");
    }

    #[test]
    fn batch_shim_line_keeps_program_and_args_quoted() {
        // 工作目录靠父进程的 current_dir 传递，不要往命令串里塞 /d：
        // 那样 cmd 会把 /d 当成待执行的程序。
        let program = std::path::Path::new(r"C:\Program Files\nodejs\codex.CMD");
        let line = super::build_cmd_line(program, &["exec".to_string(), "你好".to_string()]);
        assert!(
            !line.contains("/d"),
            "命令串里不该出现 /d，否则 cmd 会当成程序名: {line}"
        );
        assert!(
            line.contains(r#""C:\Program Files\nodejs\codex.CMD""#),
            "程序路径要带引号（路径含空格）: {line}"
        );
        // /S 会剥掉最外层一对引号，所以首尾都要多补一层 ""
        assert!(line.starts_with("\"\""), "开头要有两重引号: {line}");
        assert!(line.ends_with("\"\""), "结尾要有两重引号: {line}");
    }

    #[test]
    fn batch_shim_line_escapes_embedded_quotes() {
        let program = std::path::Path::new(r"C:\nodejs\codex.CMD");
        let line = super::build_cmd_line(program, &["a\"b".to_string()]);
        assert!(line.contains(r#"a""b"#), "参数里的引号要翻倍转义: {line}");
        // cmd /S 只会剥掉最外层的一对引号，所以首尾各多补的正好是一对：
        // 剥完剩下 "C:\nodejs\codex.CMD" "a""b"，cmd 再按常规规则把 a""b 还原成 a"b。
        // 多补一个引号会让参数尾部多出一个字符；参数还原的权威验证是
        // batch_shim_preserves_prompt_metacharacters（真的经 node 回读 argv 逐项比对）。
        assert_eq!(line, format!("\"\"{}\" \"a\"\"b\"\"", program.display()));
    }

    #[test]
    fn working_dir_is_applied_so_agent_edits_the_vault() {
        let agent = Agent {
            id: "a1".into(),
            name: "c".into(),
            kind: crate::db::models::AgentKind::Codex,
            command: "cmd".into(),
            args: vec!["exec".into()],
            description: None,
            enabled: true,
            created_at: String::new(),
        };
        let dir = std::env::temp_dir();
        let cmd = super::build_command(&agent, "hi", None, Some(&dir));
        assert_eq!(
            cmd.as_std().get_current_dir(),
            Some(dir.as_path()),
            "Agent 的工作目录必须是笔记仓库目录"
        );
    }

    /// 端到端验证：真的让一个 `.cmd` 批处理建文件，确认文件落在工作目录里，
    /// 而不是批处理自身所在的目录。走的是 build_command 的真实路径。
    /// `cargo test -- --ignored batch_shim_writes_into_work_dir` 手动跑。
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "会真的创建临时文件"]
    async fn batch_shim_writes_into_work_dir() {
        let dir = std::env::temp_dir().join("goldearth-workdir-probe");
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("_probe.txt");
        let _ = std::fs::remove_file(&marker);

        // 造一个和 npm shim 同类的 .cmd 批处理
        let shim = dir.join("probe.cmd");
        std::fs::write(&shim, "@echo off\r\necho hi > _probe.txt\r\n").unwrap();

        let agent = Agent {
            id: "a1".into(),
            name: "probe".into(),
            kind: crate::db::models::AgentKind::Custom,
            // 写绝对路径，resolve_program 会原样返回，is_batch_file 判定为批处理
            command: shim.display().to_string(),
            args: vec![],
            description: None,
            enabled: true,
            created_at: String::new(),
        };
        let mut cmd = super::build_command(&agent, "hi", None, Some(&dir));
        let status = cmd.output().await.expect("spawn 失败");
        assert!(
            status.status.success(),
            "批处理应执行成功: {:?}",
            String::from_utf8_lossy(&status.stderr)
        );

        assert!(
            marker.is_file(),
            "文件应落在工作目录 {}（实际建到了批处理所在目录，说明 /d 没生效）",
            dir.display()
        );
        let _ = std::fs::remove_file(&marker);
        let _ = std::fs::remove_file(&shim);
    }
}

#[derive(Default)]
pub struct RunRegistry {
    pub handles: HashMap<String, RunHandle>,
}

pub struct RunHandle {
    pub cancel: Option<oneshot::Sender<()>>,
    pub child: Arc<Mutex<Option<Child>>>,
}

impl RunRegistry {
    pub fn create_handle(
        &mut self,
        run_id: &str,
    ) -> (Arc<Mutex<Option<Child>>>, oneshot::Receiver<()>) {
        let holder: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
        let (tx, rx) = oneshot::channel();
        self.handles.insert(
            run_id.to_string(),
            RunHandle {
                cancel: Some(tx),
                child: holder.clone(),
            },
        );
        (holder, rx)
    }

    pub fn cancel(&mut self, run_id: &str) -> bool {
        if let Some(handle) = self.handles.get_mut(run_id) {
            if let Some(tx) = handle.cancel.take() {
                let _ = tx.send(());
            }
            if let Some(child) = handle.child.lock().as_mut() {
                let _ = child.start_kill();
            }
            true
        } else {
            false
        }
    }

    pub fn unregister(&mut self, run_id: &str) {
        self.handles.remove(run_id);
    }
}

/// `.cmd` / `.bat` 不是原生可执行文件，只能让 cmd.exe 来跑。
/// std 里的批处理转义逻辑位于它的 spawn 路径上，而 tokio 走自己的
/// CreateProcessW，不会触发，所以这里显式拼命令行。
fn is_batch_file(program: &std::path::Path) -> bool {
    matches!(
        program
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_lowercase)
            .as_deref(),
        Some("cmd") | Some("bat")
    )
}

/// 拼批处理调用的命令行。
fn build_cmd_line(program: &std::path::Path, args: &[String]) -> String {
    // /S 会剥掉最外层的一对引号，所以首尾各多补一层 ""：
    //   ""C:\path\codex.cmd" "--version""  ->  "C:\path\codex.cmd" "--version"
    // 参数外层引号同时挡住 prompt 里的 & | < > ^ 等 cmd 元字符。
    //
    // 注意不要在这里加 `/d "<目录>"`：它必须出现在 /C 之前作为 cmd.exe 自己的开关，
    // 放进命令串里 cmd 会把 `/d` 当成待执行的程序，报 "'/d' is not recognized"。
    // 实测 cmd.exe 执行批处理时沿用父进程的工作目录，不会跳到批处理所在目录，
    // 所以只需要下面的 `current_dir` 就够了。
    let mut line = format!("\"\"{}\"", program.display());
    for a in args {
        line.push_str(&format!(" \"{}\"", a.replace('"', "\"\"")));
    }
    line.push('"');
    line
}

fn build_via_cmd(
    program: &std::path::Path,
    args: &[String],
    work_dir: Option<&std::path::Path>,
) -> Command {
    let line = build_cmd_line(program, args);

    let mut cmd = Command::new("cmd.exe");
    cmd.raw_arg("/D").raw_arg("/S").raw_arg("/C").raw_arg(line);
    if let Some(dir) = work_dir {
        cmd.current_dir(dir);
    }
    cmd
}

/// codex `exec` 子命令自己的开关：
/// - `--json` 输出 JSONL 事件流，里面才有 thread_id 能用来 resume 续话
/// - `--skip-git-repo-check` 让它能在非 git 目录（笔记仓库）里跑，不然会以
///   "Not inside a trusted directory" 直接拒绝
const CODEX_FLAGS: [&str; 2] = ["--json", "--skip-git-repo-check"];

/// codex 的全局开关。
///
/// `codex exec --help` 里没有它们，但 `codex exec resume --help` 同样没有——
/// 这两个开关只认「排在 `exec` 子命令之前」的位置，所以要单独处理。
///
/// - `--sandbox workspace-write`：不加时 codex 0.162 一律以 `read-only` 启动，
///   它的权限档案里一条 write 都没有，Agent 想新建/修改 .md 会被 Windows
///   沙箱直接挡掉，PowerShell 报「访问被拒绝」。查证方式见
///   `~/.codex/sessions/**/rollout-*.jsonl` 里的 `turn_context.sandbox_policy`。
/// - `--cd <工作目录>`：把可写根显式钉到笔记仓库，不依赖进程 cwd。
const CODEX_GLOBAL_ARGS: [&str; 2] = ["--sandbox", "workspace-write"];

/// `exec` 后面可能还跟着 `resume` / `fork` / `review` 这些子命令，
/// exec 自己的开关必须排在它们之后、位置参数（session id / prompt）之前。
fn codex_flag_insert_pos(args: &[String]) -> usize {
    const SUBCOMMANDS: [&str; 3] = ["resume", "fork", "review"];
    let mut i = args.iter().position(|a| a == "exec").unwrap_or(0);
    while i + 1 < args.len() && SUBCOMMANDS.contains(&args[i + 1].as_str()) {
        i += 1;
    }
    i + 1
}

/// 把缺失的 codex 开关插到子命令之后、位置参数之前，
/// 续话时参数形如 `exec resume --json <SESSION_ID> <PROMPT>`，开关必须排在前面。
fn ensure_codex_flags(args: &mut Vec<String>) {
    let mut insert_at = codex_flag_insert_pos(args);
    for flag in CODEX_FLAGS {
        if args.iter().any(|a| a == flag) {
            continue;
        }
        args.insert(insert_at, flag.to_string());
        insert_at += 1;
    }
}

/// 把全局开关补到最前面。用户自己填过短/长写法就别重复加。
fn ensure_codex_global_args(args: &mut Vec<String>, work_dir: Option<&std::path::Path>) {
    let mut head: Vec<String> = Vec::new();
    if !args.iter().any(|a| a == "--sandbox" || a == "-s") {
        head.extend(CODEX_GLOBAL_ARGS.iter().map(|s| s.to_string()));
    }
    if let Some(dir) = work_dir {
        if !args.iter().any(|a| a == "--cd" || a == "-C") {
            head.push("--cd".to_string());
            head.push(dir.display().to_string());
        }
    }
    if head.is_empty() {
        return;
    }
    head.append(args);
    *args = head;
}

pub fn build_command(
    agent: &Agent,
    prompt: &str,
    bin_path: Option<&str>,
    work_dir: Option<&std::path::Path>,
) -> Command {
    let program = resolve_program(&agent.command, bin_path);

    let mut args: Vec<String> = Vec::with_capacity(agent.args.len() + 2);
    let mut has_placeholder = false;
    for a in &agent.args {
        if a.contains("{prompt}") {
            has_placeholder = true;
            args.push(a.replace("{prompt}", prompt));
        } else {
            args.push(a.clone());
        }
    }
    // codex 缺了这些开关就跑不起来 / 没有写权限，统一补齐。
    // 先补全局开关（要在 exec 之前），再补 exec 自己的开关。
    if agent.kind == crate::db::models::AgentKind::Codex
        && args.first().map(|a| a.as_str()) == Some("exec")
    {
        ensure_codex_global_args(&mut args, work_dir);
        ensure_codex_flags(&mut args);
    }
    if !has_placeholder {
        args.push(prompt.to_string());
    }

    let mut cmd = if is_batch_file(&program) {
        build_via_cmd(&program, &args, work_dir)
    } else {
        let mut c = Command::new(&program);
        c.args(&args);
        c
    };
    // 让 Agent 在笔记目录里工作，它新建/修改的 .md 就是 App 里的笔记
    if let Some(dir) = work_dir {
        cmd.current_dir(dir);
    }
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    cmd
}

/// 从 codex 的 JSONL 事件流里抽出回复正文与会话 ID
pub struct CodexOutput {
    pub messages: Vec<String>,
    pub errors: Vec<String>,
    pub session_id: Option<String>,
}

/// 单行 JSONL 事件里解析出来的东西。
/// 流式输出是按行喂进来的，所以解析粒度降到「一行」。
#[derive(Debug, Default, PartialEq)]
pub struct CodexLine {
    /// assistant 的正文
    pub text: Option<String>,
    pub session_id: Option<String>,
    pub error: Option<String>,
    /// 没开 --json 时的普通输出，原样带出
    pub plain: bool,
    /// 增量片段而非完整消息，拼最终输出时要跳过，否则会和完整消息重复
    pub partial: bool,
}

/// 解析一行 codex JSONL 事件。
///
/// codex 不同版本的事件形态不完全一致：`item.completed` 给整条消息，
/// 新版还会先吐 `item.updated` / delta 事件给增量文本。两种都认，
/// 用 `partial` 区分——流式展示两种都要，最终输出只认完整消息。
pub fn parse_codex_line(line: &str) -> CodexLine {
    let line = line.trim();
    if line.is_empty() {
        return CodexLine::default();
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
        return CodexLine {
            text: Some(line.to_string()),
            plain: true,
            ..CodexLine::default()
        };
    };

    let mut out = CodexLine::default();
    let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or_default();
    let item = v.get("item");
    match kind {
        "thread.started" => {
            out.session_id = v
                .get("thread_id")
                .and_then(|i| i.as_str())
                .map(str::to_string);
        }
        "item.completed" | "item.updated" | "item.started" => {
            match item.and_then(|i| i.get("type")).and_then(|t| t.as_str()) {
                Some("agent_message") => {
                    out.text = item
                        .and_then(|i| i.get("text"))
                        .and_then(|t| t.as_str())
                        .map(str::to_string);
                    out.partial = kind != "item.completed";
                }
                Some("error") => {
                    out.error = item
                        .and_then(|i| i.get("message"))
                        .and_then(|m| m.as_str())
                        .map(str::to_string);
                }
                _ => {}
            }
        }
        // 形如 agent_message_delta / item.delta 的增量文本
        _ if kind.contains("delta") => {
            out.text = v
                .get("delta")
                .or_else(|| v.get("text"))
                .and_then(|d| d.as_str())
                .map(str::to_string);
            out.partial = true;
        }
        _ => {}
    }
    out
}

/// 把逐行结果拼成完整输出。增量片段不进最终结果，
/// 保证存下来的 output 和以前完全一致。
pub fn parse_codex_output(raw: &str) -> CodexOutput {
    let mut out = CodexOutput {
        messages: Vec::new(),
        errors: Vec::new(),
        session_id: None,
    };
    for line in raw.lines() {
        let parsed = parse_codex_line(line);
        if let Some(id) = parsed.session_id {
            out.session_id = Some(id);
        }
        if parsed.partial {
            continue;
        }
        if let Some(t) = parsed.text {
            out.messages.push(t);
        }
        if let Some(e) = parsed.error {
            out.errors.push(e);
        }
    }
    out
}

/// 把逐行解析出的文本转成「相对已发出内容的新增片段」。
///
/// codex 的 text 可能是全量消息，也可能是增量片段，两种混着来，
/// 所以这里维护一份已发出的缓冲，用前缀关系把两种情况统一成增量。
#[derive(Default)]
pub struct ReplyStream {
    buf: String,
}

impl ReplyStream {
    /// 返回需要补发给前端的增量；`None` 表示这次没有新内容。
    ///
    /// 已发出的内容始终等于最终 `output` 的主体，所以中途不管收到什么形态
    /// 的事件，前端那边只需要无脑追加。
    pub fn push(&mut self, line: &CodexLine) -> Option<String> {
        let text = line.text.as_deref()?;
        if line.plain {
            self.buf.push_str(text);
            self.buf.push('\n');
            return Some(format!("{text}\n"));
        }
        if line.partial {
            self.buf.push_str(text);
            return Some(text.to_string());
        }
        // 完整消息：同一轮里重复收到全量时只补发多出来的部分
        match text.strip_prefix(self.buf.as_str()) {
            Some(rest) if rest.is_empty() => None,
            Some(rest) => {
                self.buf = text.to_string();
                Some(rest.to_string())
            }
            None => {
                self.buf = text.to_string();
                Some(text.to_string())
            }
        }
    }
}

/// 流式事件的时间片长度。
///
/// codex 吐字是按行、按片段来的，密集时逐条 `emit` 会把 WebView 的
/// IPC 通道灌满，前端来不及渲染，窗口就卡住不刷新了。
const STREAM_FLUSH_INTERVAL: std::time::Duration = std::time::Duration::from_millis(60);

/// 按时间片合并流式增量：攒够一段或超时就发一次，保证顺序和内容都不丢。
#[derive(Default)]
pub struct StreamPump {
    pending: String,
    last_flush: Option<std::time::Instant>,
}

impl StreamPump {
    /// 攒一段增量；距上次发出已经超过时间片就立刻发出去。
    pub fn push<F: FnMut(String)>(&mut self, text: String, emit: &mut F) {
        self.pending.push_str(&text);
        let now = std::time::Instant::now();
        let due = self
            .last_flush
            .map(|t| now.duration_since(t) >= STREAM_FLUSH_INTERVAL)
            .unwrap_or(true);
        if due {
            self.flush(emit);
        }
    }

    /// 把攒着的增量发出去；没攒东西就不发，避免空事件。
    pub fn flush<F: FnMut(String)>(&mut self, emit: &mut F) {
        if self.pending.is_empty() {
            return;
        }
        self.last_flush = Some(std::time::Instant::now());
        emit(std::mem::take(&mut self.pending));
    }
}

/// 拼接成展示给用户的运行输出
pub fn render_run_output(raw_stdout: &str, raw_stderr: &str) -> String {
    let parsed = parse_codex_output(raw_stdout);
    let mut parts: Vec<String> = Vec::new();
    for m in &parsed.messages {
        parts.push(m.clone());
    }
    for e in &parsed.errors {
        parts.push(format!("[提示] {e}"));
    }
    let stderr = raw_stderr.trim();
    if !stderr.is_empty() {
        parts.push(stderr.to_string());
    }
    if parts.is_empty() {
        "(无输出)".to_string()
    } else {
        parts.join("\n\n")
    }
}

/// 边读边回调，让前端能实时看到 agent 的回复，
/// 而不是等进程结束才一次性拿到全部 stdout
async fn collect_stdout<F: FnMut(&CodexLine)>(
    out: Option<tokio::process::ChildStdout>,
    sink: &mut String,
    mut on_line: F,
) {
    if let Some(stdout) = out {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            sink.push_str(&line);
            sink.push('\n');
            on_line(&parse_codex_line(&line));
        }
    }
}

async fn collect_stderr(err: Option<tokio::process::ChildStderr>, sink: &mut String) {
    if let Some(stderr) = err {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            sink.push_str(&line);
            sink.push('\n');
        }
    }
}

pub fn spawn_run<F>(
    app: AppHandle,
    storage: Arc<crate::db::Storage>,
    registry: Arc<Mutex<RunRegistry>>,
    run_id: String,
    agent: Agent,
    mut run_record: AgentRun,
    bin_path: String,
    work_dir: String,
    context: Option<String>,
    on_complete: F,
) where
    F: FnOnce(AgentRun) + Send + 'static,
{
    let (child_holder, cancel_rx) = {
        let mut reg = registry.lock();
        reg.create_handle(&run_id)
    };

    // 发事件要用到的字段先复制出来，闭包里才不会和被 move 的 run_record 抢借用
    let event_run_id = run_id.clone();
    let event_agent_id = agent.id.clone();
    let event_note_id = run_record.note_id.clone();
    let event_library_id = run_record.library_id.clone();
    let stream_app = app.clone();
    let done_app = app.clone();

    // 有上一轮会话就 resume，让对话能接着往下说
    let resume_from = run_record.session_id.clone();
    let mut working_agent = agent.clone();
    if let Some(sid) = resume_from.as_deref().filter(|s| !s.is_empty()) {
        let is_codex_exec = working_agent.kind == crate::db::models::AgentKind::Codex
            && working_agent.args.first().map(|a| a.as_str()) == Some("exec");
        if is_codex_exec && !working_agent.args.iter().any(|a| a == "resume") {
            // codex exec resume --json <SESSION_ID> <PROMPT>
            let mut new_args = vec![
                "exec".to_string(),
                "resume".to_string(),
                "--json".to_string(),
                sid.to_string(),
            ];
            new_args.extend(
                working_agent
                    .args
                    .iter()
                    .skip(1)
                    .filter(|a| *a != "--json")
                    .cloned(),
            );
            working_agent.args = new_args;
        }
    }

    let work = std::path::PathBuf::from(&work_dir);
    let work = if work.is_dir() { Some(work) } else { None };
    // 笔记上下文只在真正 spawn 时拼上去，运行记录里存的始终是用户原话，
    // 这样聊天记录读起来才是「我说了什么」，而不是一大段笔记全文
    let effective_prompt = match context.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        Some(ctx) => format!("{ctx}\n\n{}", run_record.prompt),
        None => run_record.prompt.clone(),
    };
    let mut command = build_command(
        &working_agent,
        &effective_prompt,
        Some(&bin_path),
        work.as_deref(),
    );

    tauri::async_runtime::spawn(async move {
        let child = match command.spawn() {
            Ok(c) => c,
            Err(e) => {
                run_record.status = AgentRunStatus::Failed;
                run_record.error = Some(format!(
                    "spawn error: {e}（无法启动命令 \"{}\"，请确认已安装并在 PATH 中，或直接填写可执行文件的完整路径）",
                    agent.command
                ));
                run_record.finished_at = Some(crate::db::now_iso());
                let _ = storage.update_run(run_record.clone());
                let _ = done_app.emit(DONE_EVENT, run_record.clone());
                {
                    let mut reg = registry.lock();
                    reg.unregister(&run_id);
                }
                on_complete(run_record);
                return;
            }
        };

        *child_holder.lock() = Some(child);

        let mut child = match child_holder.lock().take() {
            Some(c) => c,
            None => {
                run_record.status = AgentRunStatus::Failed;
                run_record.error = Some("child missing".into());
                run_record.finished_at = Some(crate::db::now_iso());
                let _ = storage.update_run(run_record.clone());
                let _ = done_app.emit(DONE_EVENT, run_record.clone());
                let mut reg = registry.lock();
                reg.unregister(&run_id);
                on_complete(run_record);
                return;
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let mut stdout_buf = String::new();
        let mut stderr_buf = String::new();
        let mut reply = ReplyStream::default();

        let mut emit_delta = |text: String| {
            let _ = stream_app.emit(
                STREAM_EVENT,
                StreamEvent {
                    run_id: event_run_id.clone(),
                    agent_id: event_agent_id.clone(),
                    note_id: event_note_id.clone(),
                    library_id: event_library_id.clone(),
                    text,
                },
            );
        };
        // 增量按时间片合并再发，别让密集事件灌满 IPC 通道
        let mut pump = StreamPump::default();
        collect_stdout(stdout, &mut stdout_buf, |line| {
            if let Some(err) = &line.error {
                // 出错信息也当场显示，不用等运行结束才知道失败原因；
                // 先把攒着的正文发出去，错误提示才不会插到正文中间
                pump.flush(&mut emit_delta);
                emit_delta(format!("[提示] {err}"));
            } else if let Some(delta) = reply.push(line) {
                pump.push(delta, &mut emit_delta);
            }
        })
        .await;
        pump.flush(&mut emit_delta);
        collect_stderr(stderr, &mut stderr_buf).await;

        let result: Option<(std::process::ExitStatus, bool)> = tokio::select! {
            res = child.wait() => res.ok().map(|s| (s, false)),
            _ = cancel_rx => {
                let _ = child.start_kill();
                child.wait().await.ok().map(|s| (s, true))
            }
        };

        match result {
            Some((_s, true)) => {
                run_record.status = AgentRunStatus::Cancelled;
                run_record.error = Some("cancelled by user".into());
            }
            Some((s, false)) => {
                if s.success() {
                    run_record.status = AgentRunStatus::Succeeded;
                } else {
                    run_record.status = AgentRunStatus::Failed;
                    run_record.error = Some(s.to_string());
                }
            }
            None => {
                run_record.status = AgentRunStatus::Failed;
                run_record.error = Some("process did not report a status".into());
            }
        }
        run_record.output = render_run_output(&stdout_buf, &stderr_buf);
        // 记下会话 ID，下一轮就能 resume 接着聊
        if let Some(sid) = parse_codex_output(&stdout_buf).session_id {
            run_record.session_id = Some(sid);
        }
        run_record.finished_at = Some(crate::db::now_iso());
        let _ = storage.update_run(run_record.clone());
        let _ = done_app.emit(DONE_EVENT, run_record.clone());
        {
            let mut reg = registry.lock();
            reg.unregister(&run_id);
        }
        on_complete(run_record);
    });
}
