import { useEffect, useState } from "react";
import { Github, Globe, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errText } from "@/lib/errors";
import { ROBOT_CATEGORIES, RobotSourceConfig, RobotSourceSettings, categoryLabel, robotSources } from "@/lib/robotics";

export function SourceManager({ loading, onChange }: { loading: boolean; onChange: () => Promise<void> }) {
  const [data, setData] = useState<RobotSourceSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<RobotSourceConfig>({ id: "", name: "", url: "", category: "humanoid", kind: "website" });
  async function load() {
    setError("");
    try { setData(await robotSources()); } catch (e) { setError(errText(e)); }
  }
  useEffect(() => { void load(); }, []);
  async function update(action: string, source?: RobotSourceConfig, id?: string) {
    if (saving || loading) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const next = await robotSources(action, source, id);
      setData(next);
      if (action === "add") { setForm(f => ({ ...f, name: "", url: "" })); setNotice("来源已保存，正在获取其中的技术资料。"); }
      else setNotice("来源设置已保存，收藏资料不受影响。");
      await onChange();
    } catch (e) { setError(errText(e)); }
    finally { setSaving(false); }
  }
  const selectClass = "h-9 min-w-0 rounded-md border bg-background px-2 text-xs";
  return <section className="space-y-3 border-t pt-4">
    <div><h3 className="text-sm font-semibold">国内厂家官网与官方 GitHub</h3><p className="mt-1 text-xs leading-6 text-muted-foreground">预置来源以国内厂家为主。可继续添加国内厂家的参数页、文档中心和官方仓库，也可自行补充其他参考来源。GitHub 可读取 README、文档目录及发布记录。</p></div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {notice && <p role="status" className="text-xs text-primary">{notice}</p>}
    {!data ? <Button size="sm" variant="outline" onClick={() => void load()}>重新读取来源</Button> : <>
      <form onSubmit={e => { e.preventDefault(); void update("add", form); }} className="space-y-3 rounded-lg bg-muted/30 p-3">
        <div className="grid gap-2 sm:grid-cols-3"><select aria-label="新增来源类型" className={selectClass} value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as RobotSourceConfig["kind"] }))}><option value="website">公司官网 / 技术文档站</option><option value="github">GitHub 仓库</option></select><Input aria-label="来源名称" placeholder="来源名称，如：某机器人开发文档" required maxLength={120} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /><select aria-label="新增来源所属分类" className={selectClass} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>{ROBOT_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
        <div className="flex flex-wrap gap-2"><Input className="min-w-52 flex-1" aria-label="来源地址" type="url" required maxLength={2048} placeholder={form.kind === "github" ? "https://github.com/组织/仓库" : "https://公司官网/文档或下载页"} value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} /><Button type="submit" size="sm" className="h-9" disabled={saving || loading}><Plus className="h-3.5 w-3.5" />添加来源</Button></div>
      </form>
      <div className="max-h-80 divide-y overflow-y-auto rounded-lg border">{data.sources.map(source => {
        const enabled = !data.disabled.includes(source.id);
        return <div key={source.id} className="flex items-start gap-3 p-3"><input type="checkbox" className="mt-1" aria-label={`订阅 ${source.name}`} checked={enabled} disabled={saving || loading} onChange={() => void update("toggle", undefined, source.id)} /><span className="mt-0.5 text-muted-foreground">{source.kind === "github" ? <Github className="h-4 w-4" /> : <Globe className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><div className="text-xs font-medium">{source.name}<span className="ml-2 font-normal text-muted-foreground">{categoryLabel(source.category)}</span></div><p className="mt-1 truncate text-[11px] text-muted-foreground" title={source.url}>{source.url}</p></div>{source.id.startsWith("custom:") && <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`移除来源 ${source.name}`} disabled={saving || loading} onClick={() => void update("remove", undefined, source.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}</div>;
      })}</div>
    </>}
    <p className="text-[11px] leading-5 text-muted-foreground">官网仅提取页面公开提供的文档链接，不执行网页脚本；需要登录、验证或 JavaScript 的页面可能只能手动查看。GitHub 公共接口有访问频率限制。</p>
  </section>;
}
