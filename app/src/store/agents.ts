import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { tauri } from "@/lib/tauri";
import type { Agent, AgentRun, AgentStreamEvent } from "@/types";
interface AgentsState {
  agents: Agent[];
  runs: AgentRun[];
  loading: boolean;
  error?: string;
  /** runId -> 该次运行已流式收到的回复文本 */
  stream: Record<string, string>;
  /** 订阅后端事件只需做一次 */
  initStream: () => Promise<void>;
  clearStream: (runId: string) => void;
  refresh: () => Promise<void>;
  refreshRuns: () => Promise<void>;
  create: (input: Omit<Agent, "id" | "createdAt">) => Promise<Agent>;
  update: (id: string, input: Partial<Omit<Agent, "id" | "createdAt">>) => Promise<Agent>;
  remove: (id: string) => Promise<void>;
  run: (
    agentId: string,
    prompt: string,
    sessionId?: string,
    noteId?: string,
    context?: string,
    stockCode?: string,
    libraryId?: string
  ) => Promise<AgentRun>;
  cancel: (runId: string) => Promise<void>;
}
/** 事件订阅是全局的，重复调 initStream 只订阅一次 */
let listening: Promise<void> | null = null;

export const useAgents = create<AgentsState>((set) => {
  /**
   * 流式文本先攒在这里，按帧合并后再进 store。
   *
   * codex 吐字是按行、按片段来的，事件密度高；每个事件都 setState 会让
   * WebView 主线程被 set + 重渲染打满，表现就是整个窗口卡住、刷新不出来。
   * 攒起来每帧合并一次，重渲染频率就被按在刷新率以内了。
   */
  const pending = new Map<string, string>();
  let flushHandle: number | null = null;

  const flush = () => {
    flushHandle = null;
    if (pending.size === 0) return;
    const batch = new Map(pending);
    pending.clear();
    set((s) => {
      const stream = { ...s.stream };
      for (const [runId, text] of batch) {
        stream[runId] = (stream[runId] ?? "") + text;
      }
      return { stream };
    });
  };

  const scheduleFlush = () => {
    if (flushHandle !== null) return;
    // 窗口最小化时 rAF 不会触发，文本会一直攒着，重新可见时一次补上，
    // 正好省掉了看不见时的无谓渲染
    flushHandle =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(flush)
        : (setTimeout(flush, 32) as unknown as number);
  };

  return {
    agents: [],
    runs: [],
    loading: false,
    stream: {},
    async initStream() {
      if (!listening) {
        listening = (async () => {
          // 边跑边出字：先进缓冲区，再按帧追加，不用等进程结束
          await listen<AgentStreamEvent>("agent://stream", (e) => {
            const { runId, text } = e.payload;
            pending.set(runId, (pending.get(runId) ?? "") + text);
            scheduleFlush();
          });
          // 运行结束（成功/失败/取消）：把落库的最终记录换上去
          await listen<AgentRun>("agent://done", (e) => {
            const finished = e.payload;
            // 这一轮没来得及刷出去的增量直接丢掉：最终输出以落库记录为准，
            // 不清的话稍后的帧会把已结束的 run 又画成「正在输出」
            pending.delete(finished.id);
            flush();
            set((s) => {
              // 最终输出以落库记录为准，流式缓冲顺手清掉，避免一直占着内存
              const { [finished.id]: _dropped, ...restStream } = s.stream;
              return {
                stream: restStream,
                runs: s.runs.some((r) => r.id === finished.id)
                  ? s.runs.map((r) => (r.id === finished.id ? finished : r))
                  : [finished, ...s.runs].slice(0, 100),
              };
            });
          });
        })();
      }
      return listening;
    },
    clearStream(runId) {
      pending.delete(runId);
      set((s) => {
        if (!(runId in s.stream)) return s;
        const { [runId]: _dropped, ...rest } = s.stream;
        return { stream: rest };
      });
    },
  async refresh() {
    set({ loading: true, error: undefined });
    try {
      const agents = await tauri.listAgents();
      set({ agents, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  async refreshRuns() {
    try {
      const runs = await tauri.listAgentRuns(50);
      set({ runs });
    } catch (e) {
      set({ error: String(e) });
    }
  },
  async create(input) {
    const agent = await tauri.createAgent(input);
    set((s) => ({ agents: [...s.agents, agent] }));
    return agent;
  },
  async update(id, input) {
    const agent = await tauri.updateAgent(id, input);
    set((s) => ({ agents: s.agents.map((a) => (a.id === id ? agent : a)) }));
    return agent;
  },
  async remove(id) {
    await tauri.deleteAgent(id);
    set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }));
  },
  async run(agentId, prompt, sessionId, noteId, context, stockCode, libraryId) {
    const r = await tauri.runAgent(agentId, prompt, sessionId, noteId, context, stockCode, libraryId);
    set((s) => ({ runs: [r, ...s.runs].slice(0, 100) }));
    return r;
  },
  async cancel(runId) {
    await tauri.cancelAgentRun(runId);
  },
  };
});
