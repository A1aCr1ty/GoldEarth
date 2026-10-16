import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileJson, FolderOpen, Loader2, Network, Play, Sparkles, Square, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAgents } from "@/store/agents";
import { useCategories } from "@/store/categories";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { archify, diagramTypes, extractDiagram, generationContext, loadArchifyDraft, saveArchifyDraft, renderFailureMessage, shouldRepairDiagram, MAX_ARCHIFY_REPAIRS, renderWithLayoutRepair } from "@/lib/archify";
import type { ArchifyResult, ArchifyTemplate, DiagramType, ArchifyExportFormat } from "@/lib/archify";

const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

export default function ArchifyPage() {
  const [draft, setDraft] = useState(loadArchifyDraft);
  const { type, source, prompt, agentId, runId, repairAttempts } = draft;
  const [template, setTemplate] = useState<ArchifyTemplate | null>(null);
  const [result, setResult] = useState<(ArchifyResult & { source: string; type: DiagramType }) | null>(null);
  const [rendering, setRendering] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reply, setReply] = useState("");
  const [categoryExportOpen, setCategoryExportOpen] = useState(false);
  const [exportCategoryId, setExportCategoryId] = useState("");
  const [exportFormat, setExportFormat] = useState<ArchifyExportFormat>("both");
  const [categoryExporting, setCategoryExporting] = useState(false);
  const [categoryExportError, setCategoryExportError] = useState("");
  const [exportedCategory, setExportedCategory] = useState<{ id: string | null; directory: string; files: string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const handledRun = useRef<string | null>(null);
  const agents = useAgents(s => s.agents);
  const runs = useAgents(s => s.runs);
  const stream = useAgents(s => s.stream);
  const categories = useCategories(s => s.items);
  const categoriesLoading = useCategories(s => s.loading);
  const categoriesError = useCategories(s => s.error);
  const run = runs.find(r => r.id === runId);
  const enabled = agents.filter(a => a.enabled);
  const busy = rendering || starting || !!runId || categoryExporting;
  const current = result?.ok && result.source === source && result.type === type;
  const patch = (values: Partial<typeof draft>) => setDraft(d => ({ ...d, ...values }));

  useEffect(() => {
    const store = useAgents.getState();
    void store.initStream().catch(e => setError(String(e)));
    void store.refresh();
    void store.refreshRuns();
  }, []);
  useEffect(() => {
    let alive = true;
    setTemplate(null);
    void archify.template(type).then(t => { if (alive) setTemplate(t); }).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [type]);
  useEffect(() => {
    try { saveArchifyDraft(draft); } catch { setNotice("本地草稿保存失败，请导出 JSON 保留内容。"); }
  }, [draft]);
  useEffect(() => {
    if (!agentId && enabled.length) patch({ agentId: enabled[0].id });
  }, [agents, agentId]);

  async function render(text: string, autoRepair = false) {
    setRendering(true); setError(""); setNotice("");
    try {
      const response = await renderWithLayoutRepair(type, text);
      patch({ source: response.source });
      setResult({ ...response, type });
      if (response.ok && response.repairs) setNotice(`已自动调整 ${response.repairs} 处布局并通过全部校验，预览已更新。`);
      if (!response.ok) {
        if (autoRepair && shouldRepairDiagram(response, repairAttempts) && template && enabled.some(a => a.id === agentId)) {
          setNotice(`正在根据校验诊断自动修复（${repairAttempts + 1}/${MAX_ARCHIFY_REPAIRS}）…`);
          await generate(true, { source: response.source, receipt: response.receipt, attempt: repairAttempts + 1 });
        } else {
          setError(renderFailureMessage(response));
          if (autoRepair && repairAttempts >= MAX_ARCHIFY_REPAIRS) setNotice("自动修复已达到上限，当前 JSON 和完整诊断已保留，可编辑后重新校验。");
        }
      }
    } catch (e) { setError(String(e)); }
    finally { setRendering(false); }
  }

  useEffect(() => {
    if (!runId || !run || ["pending", "running"].includes(run.status) || handledRun.current === runId) return;
    handledRun.current = runId;
    patch({ runId: null });
    setReply(run.output);
    if (run.status !== "succeeded") { setError(run.error || (run.status === "cancelled" ? "生成已停止" : "Agent 生成失败")); return; }
    try {
      const text = extractDiagram(run.output, type);
      patch({ source: text });
      void render(text, true);
    } catch (e) { setError(String(e)); }
  }, [runId, run]);

  async function generate(repair = false, retry?: { source: string; receipt: unknown; attempt: number }) {
    if (!template || !agentId || (!repair && !prompt.trim())) return;
    setStarting(true); setError(""); setReply("");
    patch({ repairAttempts: retry?.attempt ?? 0 });
    if (!retry) setNotice("");
    try {
      const store = useAgents.getState();
      await store.initStream();
      const task = await archify.prepareGeneration(
        generationContext(type, template, retry?.source ?? source, retry?.receipt ?? (repair ? result?.receipt : undefined)),
        repair ? `请根据真实校验诊断修复当前图表，保持图意、数值和关系，校验后返回完整 JSON。原始需求：${prompt}` : prompt.trim(), type);
      const response = await store.run(agentId, task);
      handledRun.current = null;
      patch({ runId: response.id });
      // Reconcile a fast completion that arrived before run() returned.
      await store.refreshRuns();
    } catch (e) { setError(String(e)); }
    finally { setStarting(false); }
  }

  async function exportFile(format: "json" | "html") {
    const content = format === "html" ? (current ? result?.html : null) : source;
    if (!content) return;
    try {
      const path = await archify.export(content, format);
      if (path) setNotice(`已导出：${path}`);
    } catch (e) { setError(String(e)); }
  }

  async function exportToCategory() {
    if (!exportCategoryId || (exportFormat !== "json" && !current)) return;
    setCategoryExporting(true); setCategoryExportError("");
    try {
      const id = exportCategoryId === "__unassigned__" ? null : exportCategoryId;
      const exported = await archify.exportToCategory(id, source, exportFormat);
      setExportedCategory({ ...exported, id });
      setNotice(`已导出 ${exported.files.length} 个文件到分类文件夹：${exported.directory}`);
      setError(""); setCategoryExportOpen(false);
    } catch (e) { setCategoryExportError(String(e)); }
    finally { setCategoryExporting(false); }
  }

  return <div className="flex h-full min-w-0 flex-col">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
      <div><h1 className="flex items-center gap-2 text-lg font-semibold"><Network className="h-5 w-5" />Archify 图表工作台</h1>
        <p className="mt-1 text-xs text-muted-foreground">描述想法或粘贴 Mermaid，由 Agent 生成；也可以直接编辑 Archify JSON。</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={!source.trim() || busy} onClick={() => {
          setCategoryExportError(""); setExportFormat(current ? "both" : "json"); setCategoryExportOpen(true);
          void useCategories.getState().refresh();
        }}><FolderOpen className="h-4 w-4" />导出到分类</Button>
        <Button variant="outline" size="sm" disabled={!source || busy} onClick={() => void exportFile("json")}><FileJson className="h-4 w-4" />导出 JSON</Button>
        <Button size="sm" disabled={!current || busy} onClick={() => void exportFile("html")}><Download className="h-4 w-4" />导出 HTML</Button>
      </div>
    </header>
    <Dialog open={categoryExportOpen} onOpenChange={open => { if (!categoryExporting) setCategoryExportOpen(open); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>导出到分类文件夹</DialogTitle><DialogDescription>保存到当前存储位置下的 vault 分类目录，文件按图表标题自动命名。</DialogDescription></DialogHeader>
        <label className="space-y-2 text-sm">目标分类
          <select aria-label="导出目标分类" className={`${selectClass} mt-2 w-full`} value={exportCategoryId} disabled={categoryExporting || categoriesLoading} onChange={e => setExportCategoryId(e.target.value)}>
            <option value="">{categoriesLoading ? "正在读取分类…" : "请选择分类"}</option>
            {categories.map(category => <option value={category.id} key={category.id}>{category.icon || "📁"} {category.name}</option>)}
            <option value="__unassigned__">未分类</option>
          </select>
        </label>
        <label className="space-y-2 text-sm">文件格式
          <select aria-label="分类导出格式" className={`${selectClass} mt-2 w-full`} value={exportFormat} disabled={categoryExporting} onChange={e => setExportFormat(e.target.value as ArchifyExportFormat)}>
            <option value="both" disabled={!current}>HTML + JSON（查看器与源码）</option>
            <option value="html" disabled={!current}>HTML（交互查看器）</option>
            <option value="json">JSON（图表源码）</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground">{current ? "HTML 导出会再次校验当前图表。同名图表会保存为新文件。" : "当前可导出 JSON。导出 HTML 前请先点击「校验并预览」。"}</p>
        {(categoryExportError || categoriesError) && <p role="alert" className="break-words text-sm text-destructive">{categoryExportError || categoriesError}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={categoryExporting} onClick={() => setCategoryExportOpen(false)}>取消</Button>
          <Button disabled={categoryExporting || categoriesLoading || !!categoriesError || !exportCategoryId ||
            (exportCategoryId !== "__unassigned__" && !categories.some(category => category.id === exportCategoryId)) || (exportFormat !== "json" && !current)} onClick={() => void exportToCategory()}>
            {categoryExporting && <Loader2 className="h-4 w-4 animate-spin" />}{categoryExporting ? "正在导出…" : "保存到分类"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-auto p-3 lg:flex-row lg:overflow-hidden">
      <section className="flex w-full shrink-0 flex-col gap-3 lg:w-[340px] lg:overflow-auto">
        <div className="rounded-lg border bg-card p-3 space-y-3">
          <label className="flex items-center justify-between text-sm">图表类型
            <select aria-label="图表类型" className={selectClass} value={type} disabled={busy} onChange={e => { patch({ type: e.target.value as DiagramType }); setResult(null); setError(""); }}>
              {Object.entries(diagramTypes).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
            </select>
          </label>
          {template && <p className="text-xs text-muted-foreground">{template.runtime ? `渲染环境就绪 · Node.js ${template.runtime}` : "渲染需要 Node.js 18+。安装后重启应用，或设置 GOLDEARTH_NODE 为可执行文件路径。"}</p>}
          <label className="block text-sm" htmlFor="archify-agent">生成 Agent</label>
          <select id="archify-agent" className={`${selectClass} w-full`} value={agentId} disabled={busy} onChange={e => patch({ agentId: e.target.value })}>
            <option value="">选择 Agent</option>{enabled.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">请选择支持读取本地文件的 Agent，例如 Codex 或 Claude Code。</p>
          {!enabled.length && <p className="text-xs text-muted-foreground">请先在 <Link className="underline" to="/agents">Agent 页面</Link>配置并启用 Agent。JSON 编辑与渲染可独立使用。</p>}
          <Textarea aria-label="图表需求或 Mermaid" placeholder="例如：画出浏览器、API 服务、数据库与异步任务队列之间的关系。也可以粘贴 Mermaid。" className="min-h-[120px]" value={prompt} disabled={busy} onChange={e => patch({ prompt: e.target.value })} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !template?.runtime || !prompt.trim() || !enabled.some(a => a.id === agentId)} onClick={() => void generate()}><Sparkles className="h-4 w-4" />生成图表</Button>
            {runId && <Button variant="outline" size="sm" onClick={() => void useAgents.getState().cancel(runId).catch(e => { setError(String(e)); patch({ runId: null }); })}><Square className="h-3 w-3" />停止</Button>}
            {result && !result.ok && result.failureKind !== "runtime" && <Button variant="outline" size="sm" disabled={busy || !template || !enabled.some(a => a.id === agentId)} onClick={() => void generate(true)}>Agent 修复</Button>}
          </div>
          {(runId || starting) && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{repairAttempts ? `Agent 正在修复布局（${repairAttempts}/${MAX_ARCHIFY_REPAIRS}）…` : "Agent 正在生成图表…"}</p>}
          {(reply || (runId && stream[runId])) && <details className="text-xs"><summary className="cursor-pointer">Agent 回复</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all">{runId ? stream[runId] : reply}</pre></details>}
        </div>
        <div className="flex min-h-[340px] flex-1 flex-col gap-2 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="archify-source" className="text-sm font-medium">JSON 源码</label>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" disabled={busy || !template} onClick={() => { if (!source.trim() || window.confirm("载入示例将替换当前草稿，是否继续？")) { patch({ source: JSON.stringify(template!.example, null, 2) }); setResult(null); } }}>载入示例</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}><Upload className="h-3 w-3" />导入</Button>
            </div></div>
          <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={async e => {
            const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
            try {
              if (file.size > 1_000_000) throw Error("JSON 文件不能超过 1 MB");
              const text = await file.text(); const value = JSON.parse(text);
              if (!value || !Object.prototype.hasOwnProperty.call(diagramTypes, value.diagram_type)) throw Error("无法识别图表类型");
              if (source.trim() && !window.confirm("导入将替换当前草稿，是否继续？")) return;
              patch({ source: JSON.stringify(value, null, 2), type: value.diagram_type }); setResult(null); setError("");
            } catch (err) { setError(String(err)); }
          }} />
          <Textarea id="archify-source" className="min-h-[240px] flex-1 resize-none font-mono text-xs" spellCheck={false} value={source} disabled={busy} onChange={e => patch({ source: e.target.value })} placeholder="载入示例，或导入 Archify JSON 开始编辑" />
          <Button disabled={busy || !source.trim() || !template?.runtime} onClick={() => void render(source)}>{rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}校验并预览</Button>
          <p className="text-xs text-muted-foreground">草稿自动保存在本机。HTML 包含完整交互查看器，可离线打开。</p>
        </div>
      </section>
      <section className="flex min-h-[480px] min-w-0 flex-1 flex-col overflow-auto rounded-lg border bg-card lg:min-h-0">
        <div className="flex items-center justify-between gap-2 border-b p-3 text-sm"><span className="font-medium">交互预览</span>
          <span className="text-xs text-muted-foreground">{rendering ? "校验中…" : current ? "9 项校验通过 · showcase" : result?.ok ? "源码已修改，请重新校验" : result ? (result.failureKind === "runtime" ? "运行失败" : "校验失败") : "等待生成"}</span></div>
        {error && <p role="alert" className="shrink-0 whitespace-pre-wrap break-words border-b p-3 text-sm text-destructive">{error}</p>}
        {result && !result.ok && <details className="shrink-0 border-b p-3 text-xs" open><summary className="cursor-pointer">{result.failureKind === "runtime" ? "运行诊断" : "校验诊断"}</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(result.receipt, null, 2)}</pre></details>}
        {notice && <p role="status" className="break-all border-b p-3 text-xs text-muted-foreground">{notice}</p>}
        {exportedCategory && <div className="shrink-0 border-b p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2"><span>已保存到：{exportedCategory.directory}</span>
            <Button variant="outline" size="sm" onClick={() => void archify.openCategoryFolder(exportedCategory.id).catch(e => setError(String(e)))}><FolderOpen className="h-3 w-3" />打开分类文件夹</Button></div>
          <ul className="mt-1 space-y-1 break-all text-muted-foreground">{exportedCategory.files.map(file => <li key={file}>{file.split(/[\\/]/).pop()}</li>)}</ul>
        </div>}
        {result?.html ? <iframe title="Archify 交互图表" className="min-h-[400px] w-full flex-1 bg-white" sandbox="allow-scripts allow-downloads" srcDoc={result.html} />
          : <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground"><Network className="h-12 w-12 opacity-30" /><p className="text-sm">把想法变成可以探索的图表</p><p className="max-w-sm text-xs leading-6">支持架构、流程、时序、数据流与状态图。生成后可在查看器中切换主题、缩放、搜索和追踪关系，并导出图片。</p></div>}
        {result?.ok && <details className="shrink-0 border-t p-3 text-xs"><summary className="cursor-pointer">校验凭据与 SHA-256</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(result.receipt, null, 2)}</pre><p className="mt-2 text-muted-foreground">结构与构图检查已通过，请在预览中检查实际可读性。</p></details>}
      </section>
    </div>
  </div>;
}
