import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tauri } from "@/lib/tauri";
import { signed } from "@/lib/format";
import { analyzeFundamentals, buildFinancialContext, latestFinancialReport, peerMedian, type FundamentalAnalysis } from "@/lib/fundamental";
import { parseAgentPeerSelection, type AgentPeerSelection } from "@/lib/peerComparison";
import { useAgents } from "@/store/agents";
import type { FinancialReports, Quote } from "@/types";

interface PeerRow extends AgentPeerSelection {
  financial: FinancialReports | null;
  quote: Quote | null;
  error: string;
}

interface SavedComparison {
  industry: string;
  peers: AgentPeerSelection[];
  rows: PeerRow[];
  agentOutput: string;
  savedAt: string;
}

function readSavedComparison(key: string, currentCode: string): SavedComparison | null {
  try {
    const data = JSON.parse(localStorage.getItem(key) || "null");
    if (data?.version !== 1 || data.currentCode !== currentCode) return null;
    const selection = parseAgentPeerSelection(JSON.stringify({ schemaVersion: 1, currentCode: currentCode.slice(2), industry: data.industry, peers: data.peers }), currentCode);
    const codes = new Set(selection.peers.map(peer => peer.code));
    const rows = Array.isArray(data.rows) ? data.rows.filter((row: PeerRow) => codes.has(row?.code)).map((row: PeerRow) => ({
      code: row.code, name: String(row.name || row.code.slice(2)), reason: String(row.reason || ""),
      financial: row.financial ?? null, quote: row.quote ?? null, error: String(row.error || ""),
    })) : [];
    return { industry: selection.industry, peers: selection.peers, rows, agentOutput: String(data.agentOutput || ""), savedAt: String(data.savedAt || "") };
  } catch { return null; }
}

const finite = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value);
const positive = (value: number | null | undefined) => finite(value) && value > 0 ? value : null;
const text = (value: number | null | undefined, digits = 2) => finite(value) ? value.toFixed(digits) : "—";
const percent = (value: number | null | undefined) => finite(value) ? signed(value) : "—";

function relative(current: number | null, median: number | null) {
  if (current === null || median === null || median === 0) return "待比较";
  const difference = (current / median - 1) * 100;
  return `${difference >= 0 ? "高" : "低"} ${Math.abs(difference).toFixed(1)}%`;
}

export function StockPeerComparison({ current }: {
  current: { code: string; name: string; financial: FinancialReports; analysis: FundamentalAnalysis; quote: Quote | null };
}) {
  const agents = useAgents(state => state.agents);
  const runs = useAgents(state => state.runs);
  const refreshAgents = useAgents(state => state.refresh);
  const initStream = useAgents(state => state.initStream);
  const runAgent = useAgents(state => state.run);
  const cancelAgent = useAgents(state => state.cancel);
  const enabledAgents = useMemo(() => agents.filter(agent => agent.enabled), [agents]);
  const storageKey = `goldearth.fundamental-agent-peers.v1.${current.code}`;
  const [initial] = useState(() => readSavedComparison(storageKey, current.code));
  const [agentId, setAgentId] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [industry, setIndustry] = useState(initial?.industry ?? "");
  const [peers, setPeers] = useState<AgentPeerSelection[]>(initial?.peers ?? []);
  const [rows, setRows] = useState<PeerRow[]>(initial?.rows ?? []);
  const [agentOutput, setAgentOutput] = useState(initial?.agentOutput ?? "");
  const [savedAt, setSavedAt] = useState(initial?.savedAt ?? "");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const handledRun = useRef<string | null>(null);
  const signature = peers.map(peer => `${peer.code}:${peer.reason}`).join("|");
  const run = runs.find(item => item.id === runId);
  const busy = starting || run?.status === "running";

  useEffect(() => { void initStream(); void refreshAgents(); }, [initStream, refreshAgents]);
  useEffect(() => {
    if (agentId) return;
    const saved = localStorage.getItem("goldearth.stockAgentId");
    if (saved && enabledAgents.some(agent => agent.id === saved)) setAgentId(saved);
    else if (enabledAgents.length) setAgentId(enabledAgents[0].id);
  }, [agentId, enabledAgents]);

  useEffect(() => {
    if (!run || run.status === "running" || handledRun.current === run.id) return;
    handledRun.current = run.id;
    if (run.status !== "succeeded") { setError(run.error || `Agent 运行${run.status === "cancelled" ? "已取消" : "失败"}`); return; }
    try {
      const selection = parseAgentPeerSelection(run.output, current.code);
      setIndustry(selection.industry);
      setPeers(selection.peers);
      setAgentOutput(run.output);
      setSavedAt(new Date().toISOString());
      setError("");
    } catch (e) { setError(`同行筛选结果不可用：${String(e)}`); }
  }, [run, current.code]);

  useEffect(() => {
    let active = true;
    if (!peers.length) { setRows([]); return; }
    setLoading(true);
    void Promise.all(peers.map(async peer => {
      const [financial, quote] = await Promise.allSettled([
        tauri.stockFinancialReports(peer.code, revision > 0),
        tauri.stockQuote(peer.code),
      ]);
      const errors: string[] = [];
      if (financial.status === "rejected") errors.push(`财报：${String(financial.reason)}`);
      if (quote.status === "rejected") errors.push(`行情：${String(quote.reason)}`);
      return {
        ...peer,
        financial: financial.status === "fulfilled" ? financial.value : null,
        quote: quote.status === "fulfilled" ? quote.value : null,
        error: errors.join("；"),
      };
    })).then(value => { if (active) { setRows(value); setSavedAt(new Date().toISOString()); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [signature, revision]);

  useEffect(() => {
    if (!peers.length) return;
    const snapshot = {
      version: 1, currentCode: current.code, industry, peers, agentOutput, savedAt,
      rows: rows.map(row => ({ ...row, financial: row.financial ? { ...row.financial, reports: row.financial.reports.slice(0, 1) } : null })),
    };
    try { localStorage.setItem(storageKey, JSON.stringify(snapshot)); setSaveError(""); }
    catch (e) { setSaveError(`对比结果保存失败：${String(e)}`); }
  }, [storageKey, current.code, industry, peers, rows, agentOutput, savedAt]);

  async function selectPeers() {
    if (!agentId || busy) return;
    localStorage.removeItem(storageKey);
    setStarting(true); setError(""); setSaveError(""); setIndustry(""); setPeers([]); setRows([]); setAgentOutput(""); setSavedAt(""); setRunId(null);
    handledRun.current = null;
    const code = current.code.slice(2);
    const prompt = `请为A股上市公司${current.name}（${code}）自动筛选3至4家同行业可比公司，用于基本面对比。以主营业务、产品结构和商业模式的可比性为标准，尽量细分行业，不要仅凭股票名称，不要选择当前公司。若具备联网能力可核验主营业务；不要编造财务数值、估值或实时信息。只返回JSON，不要Markdown，格式为：{"schemaVersion":1,"currentCode":"${code}","industry":"细分行业","peers":[{"code":"6位A股代码","name":"公司名称","reason":"主营业务可比理由"}]}。至少返回1家有效同行，reason只说明行业关系，不写买卖建议。`;
    const context = [buildFinancialContext(current.financial, current.analysis), `当前行情仅作证券身份核对：${JSON.stringify(current.quote ? { code: current.quote.code, name: current.quote.name, time: current.quote.time } : null)}`].join("\n\n");
    try {
      await initStream();
      const result = await runAgent(agentId, prompt, undefined, undefined, context, current.code);
      setRunId(result.id);
    } catch (e) { setError(`Agent 同行筛选启动失败：${String(e)}`); }
    finally { setStarting(false); }
  }

  const peerAnalysis = rows.map(row => {
    const latest = latestFinancialReport(row.financial);
    return { ...row, analysis: latest ? analyzeFundamentals(latest) : null };
  });
  const analyses = peerAnalysis.map(row => row.analysis);
  const medians = {
    pe: peerMedian(rows.map(row => positive(row.quote?.pe))),
    pb: peerMedian(rows.map(row => positive(row.quote?.pb))),
    revenue: peerMedian(analyses.map(analysis => analysis?.report.revenueYoy)),
    profit: peerMedian(analyses.map(analysis => analysis?.report.netProfitYoy)),
    roe: peerMedian(analyses.map(analysis => analysis?.annualizedRoe)),
    margin: peerMedian(analyses.map(analysis => analysis?.report.grossMargin)),
    debt: peerMedian(analyses.map(analysis => analysis?.report.debtRatio)),
    score: peerMedian(analyses.map(analysis => analysis?.score)),
  };
  const currentPe = positive(current.quote?.pe);
  const currentPb = positive(current.quote?.pb);
  const roeDifference = current.analysis.annualizedRoe !== null && medians.roe !== null
    ? current.analysis.annualizedRoe - medians.roe : null;
  const companies = [{ code: current.code, name: current.name, quote: current.quote, analysis: current.analysis, error: "", reason: "当前公司", current: true },
    ...peerAnalysis.map(row => ({ ...row, current: false }))];

  return <section className="space-y-3 rounded-lg border bg-card p-4">
    <div className="flex flex-wrap items-center gap-2">
      <div className="mr-auto"><h2 className="text-base font-semibold">Agent 同行业筛选与基本面对比</h2><p className="mt-1 text-[0.6875rem] text-muted-foreground">Agent自动判断细分行业并选择最多4家同行，无需人工添加；应用另行获取真实财报和行情，不采用Agent自报数值。</p></div>
      <select aria-label="同行筛选 Agent" className="h-8 rounded border bg-background px-2 text-xs" value={agentId} disabled={busy} onChange={event => { setAgentId(event.target.value); localStorage.setItem("goldearth.stockAgentId", event.target.value); }}>
        {!enabledAgents.length && <option value="">请先配置 Agent</option>}
        {enabledAgents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select>
      <Button size="sm" disabled={!agentId || busy} onClick={() => void selectPeers()}><Sparkles className="h-3.5 w-3.5" />{busy ? "Agent筛选中…" : peers.length ? "重新筛选并对比" : "Agent筛选同行并对比"}</Button>
      {busy && <Button size="sm" variant="outline" onClick={() => { if (runId) void cancelAgent(runId).catch(e => setError(String(e))); }}><Square className="h-3 w-3" />停止</Button>}
      <Button size="sm" variant="outline" disabled={!peers.length || loading || busy} onClick={() => setRevision(value => value + 1)}><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />刷新财报行情</Button>
    </div>
    {!enabledAgents.length && <p className="text-muted-foreground">还没有可用的 Agent，请先到「Agent」页配置并启用。</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {saveError && <p role="alert" className="text-destructive">{saveError}</p>}
    {savedAt && <p className="text-[0.6875rem] text-muted-foreground">最新结果已保存 · {new Date(savedAt).toLocaleString("zh-CN")} · 再次筛选会覆盖此结果</p>}
    {busy && <p role="status" className="text-muted-foreground">Agent正在筛选同行，完成后会自动获取各公司财报与最新行情…</p>}
    {loading && <p role="status" className="text-muted-foreground">正在获取同行财报与最新行情…</p>}
    {!peers.length && !busy && <p className="rounded-md border border-dashed p-4 text-muted-foreground">点击“Agent筛选同行并对比”，系统会自动形成同行业对比组，无需人工确认公司。</p>}
    {industry && <p><b>Agent判断的细分行业：{industry}</b><span className="ml-2 text-muted-foreground">行业关系为Agent判断，并非交易所行业分类。</span></p>}
    {peers.length > 0 && <>
      <p className="leading-5">当前 PE 较同行中位数{relative(currentPe, medians.pe)}，PB {relative(currentPb, medians.pb)}；年化 ROE {roeDifference === null ? "待比较" : `${roeDifference >= 0 ? "高" : "低"} ${Math.abs(roeDifference).toFixed(2)} 个百分点`}。这些只是组内数值差异，不直接代表高估、低估或买卖建议。</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left"><thead className="border-y bg-muted/40 text-muted-foreground"><tr>{["公司 / 报告期", "现价 / 当日", "PE / PB", "营收同比", "归母净利同比", "年化ROE", "毛利率", "资产负债率", "基本面评分", "Agent同行理由"].map(label => <th className="px-3 py-2 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>
        {companies.map(company => <tr className={`border-b ${company.current ? "bg-accent/30" : ""}`} key={company.code}>
          <td className="px-3 py-2"><b>{company.name}{company.current ? "（当前）" : ""}</b><div className="mt-1 text-muted-foreground">{company.code.slice(2)} · {company.analysis?.report.reportDate ?? "无有效财报"}</div>{company.error && <div className="mt-1 text-destructive">{company.error}</div>}</td>
          <td className="px-3 py-2">{positive(company.quote?.price)?.toFixed(2) ?? "—"}<div className="mt-1 text-muted-foreground">{percent(company.quote?.changePct)}</div></td>
          <td className="px-3 py-2">{text(positive(company.quote?.pe))} / {text(positive(company.quote?.pb))}</td>
          <td className="px-3 py-2">{percent(company.analysis?.report.revenueYoy)}</td>
          <td className="px-3 py-2">{percent(company.analysis?.report.netProfitYoy)}</td>
          <td className="px-3 py-2">{percent(company.analysis?.annualizedRoe)}</td>
          <td className="px-3 py-2">{percent(company.analysis?.report.grossMargin)}</td>
          <td className="px-3 py-2">{percent(company.analysis?.report.debtRatio)}</td>
          <td className="px-3 py-2">{company.analysis?.score ?? "—"}{company.analysis ? ` · ${company.analysis.rating}` : ""}</td>
          <td className="max-w-xs px-3 py-2 leading-5">{company.current ? "—" : company.reason}</td>
        </tr>)}
        <tr className="border-b bg-muted/20 font-medium"><td className="px-3 py-2">同行中位数（不含当前）</td><td className="px-3 py-2">—</td><td className="px-3 py-2">{text(medians.pe)} / {text(medians.pb)}</td><td className="px-3 py-2">{percent(medians.revenue)}</td><td className="px-3 py-2">{percent(medians.profit)}</td><td className="px-3 py-2">{percent(medians.roe)}</td><td className="px-3 py-2">{percent(medians.margin)}</td><td className="px-3 py-2">{percent(medians.debt)}</td><td className="px-3 py-2">{text(medians.score, 0)}</td><td /></tr>
      </tbody></table></div>
      <p className="text-[0.6875rem] leading-5 text-muted-foreground">ROE为报告期简单年化参考；增长、利润率和负债率均沿用各公司最新有效报告，报告期可能不同。PE/PB使用最新可取得报价，亏损或无效估值显示为“—”。跨公司比较还需核对业务结构、会计口径和行业周期。</p>
    </>}
    {(run || agentOutput) && <details className="text-[0.6875rem]"><summary className="cursor-pointer text-muted-foreground">查看Agent筛选原始回复</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/30 p-3">{run?.output || run?.error || agentOutput || "等待回复…"}</pre></details>}
  </section>;
}
