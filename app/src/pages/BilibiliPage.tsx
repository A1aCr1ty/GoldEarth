import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";


type Creator = { uid: string; name: string };
const storageKey = "gold-earth.bilibili.creators";
export function parseBilibiliUid(raw: string): string | null {
  const value = raw.trim();
  if (/^[1-9]\d{0,19}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "space.bilibili.com") return null;
    const uid = url.pathname.split("/")[1];
    return /^[1-9]\d{0,19}$/.test(uid) ? uid : null;
  } catch { return null; }
}
function readCreators(): Creator[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(data) ? data.filter((item): item is Creator => !!item && typeof item.uid === "string" && parseBilibiliUid(item.uid) === item.uid && typeof item.name === "string") : [];
  } catch { return []; }
}
type Reply = { rpid_str?: string; rpid?: number; member?: { uname?: string }; content?: { message?: string }; like?: number; replies?: Reply[] };
type Dynamic = { id_str: string; basic?: { comment_id_str?: string; comment_type?: number }; modules?: { module_author?: { name?: string; pub_time?: string }; module_dynamic?: { desc?: { text?: string }; major?: { archive?: { title?: string; desc?: string }; draw?: { items?: { src: string }[] }; article?: { title?: string } } } }; orig?: Dynamic };
type Feed = { items?: Dynamic[]; offset?: string; has_more?: boolean };
type Comments = { replies?: Reply[]; page?: { count?: number; size?: number } };
async function request<T>(args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>("bilibili_data", args);
}
function Body({ item }: { item: Dynamic }) {
  const dynamic = item.modules?.module_dynamic;
  return <div className="space-y-3">
    <p className="whitespace-pre-wrap break-words">{dynamic?.desc?.text}</p>
    {dynamic?.major?.archive && <div className="rounded border p-3"><strong>视频 · {dynamic.major.archive.title}</strong><p className="text-sm text-muted-foreground">{dynamic.major.archive.desc}</p></div>}
    {dynamic?.major?.article && <p>专栏 · {dynamic.major.article.title}</p>}
    <div className="grid grid-cols-3 gap-2">{dynamic?.major?.draw?.items?.map(image => /^https:\/\//.test(image.src) && <img key={image.src} src={image.src} alt="动态配图" loading="lazy" referrerPolicy="no-referrer" className="max-h-64 rounded object-contain" />)}</div>
    {item.orig && <blockquote className="border-l-2 pl-3 text-muted-foreground"><p>{item.orig.modules?.module_author?.name}：</p><Body item={{ ...item.orig, orig: undefined }} /></blockquote>}
    {!dynamic?.desc && !dynamic?.major && !item.orig && <p className="text-muted-foreground">此动态类型暂不支持正文展示。</p>}
  </div>;
}
function Replies({ items }: { items: Reply[] }) {
  return <div className="space-y-3">{items.map((reply, index) => <div key={reply.rpid_str || reply.rpid || index} className="border-l pl-3"><p className="text-xs text-muted-foreground">{reply.member?.uname || "用户"} · {reply.like || 0} 赞</p><p className="whitespace-pre-wrap break-words text-sm">{reply.content?.message}</p>{reply.replies?.length ? <Replies items={reply.replies} /> : null}</div>)}</div>;
}
function CommentPanel({ item, cookie }: { item: Dynamic; cookie: string }) {
  const [items, setItems] = useState<Reply[]>([]);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<0 | 2>(0);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(true);
  const [error, setError] = useState("");
  async function load(order: 0 | 2 = sort, reset = false) {
    const nextPage = reset ? 1 : page + 1;
    if (reset) { setSort(order); setItems([]); setPage(0); setMore(true); }
    setBusy(true); setError("");
    try {
      const data = await request<Comments>({ kind: "comments", id: item.basic?.comment_id_str || item.id_str, replyType: item.basic?.comment_type || 17, page: nextPage, sort: order, cookie });
      const next = data.replies || [];
      setItems(old => reset ? next : [...old, ...next]); setPage(nextPage);
      setMore(next.length > 0 && nextPage * (data.page?.size || 20) < (data.page?.count || 0));
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <section className="mt-4 space-y-3 border-t pt-3"><div className="flex items-center gap-2" role="group" aria-label="评论排序"><span className="mr-auto text-sm font-medium">评论</span>{([{ value: 2, label: "按热度" }, { value: 0, label: "按时间" }] as const).map(option => <Button key={option.value} size="sm" variant={sort === option.value ? "default" : "ghost"} aria-pressed={sort === option.value} disabled={busy} onClick={() => { if (sort !== option.value) void load(option.value, true); }}>{option.label}</Button>)}</div><Replies items={items} />{page > 0 && items.length === 0 && <p className="text-sm text-muted-foreground">暂无评论</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{more && <Button variant="outline" disabled={busy} onClick={() => void load()}>{busy ? "加载中…" : page ? "加载更多评论" : "查看评论"}</Button>}<p className="text-xs text-muted-foreground">楼中楼显示接口返回的回复预览。</p></section>;
}
export default function BilibiliPage() {
  const [creators, setCreators] = useState<Creator[]>(readCreators);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [uid, setUid] = useState("");
  const [cookie, setCookie] = useState("");
  const [cookieReady, setCookieReady] = useState(false);
  const [cookieStatus, setCookieStatus] = useState("");
  useEffect(() => {
    let active = true;
    import("@tauri-apps/api/core").then(({ invoke }) => invoke<string>("bilibili_cookie")).then(value => {
      if (active) { setCookie(value); setCookieStatus(value ? "已恢复本机保存的 Cookie" : "尚未保存 Cookie"); }
    }).catch(() => { if (active) setCookieStatus("读取 Cookie 失败，可重新填写并保存"); })
      .finally(() => { if (active) setCookieReady(true); });
    return () => { active = false; };
  }, []);
  async function saveCookie(clear = false) {
    setCookieReady(false);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("bilibili_cookie", { value: clear ? "" : cookie.trim() });
      if (clear) setCookie("");
      setCookieStatus(clear || !cookie.trim() ? "已清除保存的 Cookie" : "已加密保存，下次启动自动恢复");
    } catch (e) { setCookieStatus(String(e)); }
    finally { setCookieReady(true); }
  }
  const [items, setItems] = useState<Dynamic[]>([]);
  const [offset, setOffset] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function persist(next: Creator[]) { try { localStorage.setItem(storageKey, JSON.stringify(next)); setCreators(next); } catch { setError("无法保存 UP 主列表"); } }
  async function load(target: string, append = false) {
    setBusy(true); setError("");
    if (!append) { setUid(target); setItems([]); setOffset(""); setMore(false); }
    try {
      const data = await request<Feed>({ kind: "feed", id: target, offset: append ? offset : "", cookie });
      setItems(old => { const list = append ? [...old, ...(data.items || [])] : data.items || []; return [...new Map(list.map(item => [item.id_str, item])).values()]; });
      setMore(!!data.has_more && !!data.offset && data.offset !== (append ? offset : "")); setOffset(data.offset || "");
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <div className="h-full overflow-auto p-6"><div className="mx-auto max-w-4xl space-y-5">
    <header><h1 className="text-2xl font-semibold">Bilibili 动态</h1><p className="mt-2 text-sm text-muted-foreground">在本地查看 UP 主动态与评论</p></header>
    <form className="flex flex-wrap gap-2 rounded-xl border p-4" onSubmit={e => { e.preventDefault(); const value = parseBilibiliUid(input); if (!value) { setError("请输入有效 UID 或个人空间链接"); return; } persist([...creators.filter(c => c.uid !== value), { uid: value, name: name.trim() || value }]); void load(value); }}>
      <Input className="min-w-48 flex-1" aria-label="UID 或个人空间链接" placeholder="UID 或个人空间链接" value={input} onChange={e => setInput(e.target.value)} required />
      <Input className="w-40" aria-label="备注" placeholder="备注（可选）" value={name} onChange={e => setName(e.target.value)} />
      <Button disabled={busy}>保存并读取</Button>
    </form>
    <details className="rounded border p-3 text-sm"><summary>登录凭据（接口要求登录时填写）</summary><Input type="password" aria-label="Bilibili Cookie" disabled={!cookieReady} autoComplete="off" placeholder="粘贴自己的 Bilibili Cookie" value={cookie} onChange={e => setCookie(e.target.value)} className="mt-3" /><p className="mt-2 text-xs text-muted-foreground">使用 Windows 用户级加密长期保存在本机，重启自动恢复；B 站使其失效后需重新填写。</p><div className="mt-3 flex gap-2"><Button disabled={!cookieReady} onClick={() => void saveCookie()}>保存 Cookie</Button><Button variant="outline" disabled={!cookieReady} onClick={() => void saveCookie(true)}>清除 Cookie</Button></div><p role="status" className="mt-2 text-xs text-muted-foreground">{cookieStatus}</p></details>
    <div className="flex flex-wrap gap-2">{creators.map(c => <div key={c.uid} className="flex items-center rounded border"><Button variant={uid === c.uid ? "default" : "ghost"} disabled={busy} onClick={() => void load(c.uid)}>{c.name}</Button><Button variant="ghost" aria-label={`移除 ${c.name}`} onClick={() => persist(creators.filter(v => v.uid !== c.uid))}>×</Button></div>)}</div>
    {error && <p role="alert" className="rounded bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {uid && <Button variant="outline" disabled={busy} onClick={() => void load(uid)}>刷新动态</Button>}
    {items.map(item => <article key={`${uid}-${item.id_str}`} className="rounded-xl border bg-card p-5"><header className="mb-4"><h2 className="font-semibold">{item.modules?.module_author?.name || uid}</h2><p className="text-xs text-muted-foreground">{item.modules?.module_author?.pub_time}</p></header><Body item={item} /><CommentPanel item={item} cookie={cookie} /></article>)}
    {busy && <p role="status">正在读取 Bilibili 数据…</p>}
    {!busy && !error && items.length === 0 && <p className="py-10 text-center text-muted-foreground">{uid ? "该用户暂无可读取的动态" : "添加或选择一个 UP 主开始读取"}</p>}
    {more && <Button disabled={busy} onClick={() => void load(uid, true)}>加载更多动态</Button>}
  </div></div>;
}

