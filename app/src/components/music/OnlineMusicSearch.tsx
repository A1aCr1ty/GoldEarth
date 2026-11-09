import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, Download, ExternalLink, Globe2, Loader2, Music2, Radio, Search, X } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { OnlineMusic, onlineMusicId } from "@/lib/onlineMusic";
import { MUSIC_PROVIDERS, MusicProvider, musicProviderName, searchMusicProvider } from "@/lib/musicCatalog";
import { musicTime } from "@/lib/music";
import { useMusic } from "@/store/music";

type Selection = "all" | MusicProvider;
interface Results {
  query: string;
  items: OnlineMusic[];
  next: Partial<Record<MusicProvider, number | null>>;
  status: Partial<Record<MusicProvider, string>>;
  warnings: Partial<Record<MusicProvider, string>>;
}
const emptyResults = (query = ""): Results => ({ query, items: [], next: {}, status: {}, warnings: {} });
const TOPICS = [["Lo-fi", "lofi"], ["轻音乐", "instrumental"], ["电子", "electronic"], ["爵士", "jazz"], ["古典", "classical"], ["摇滚", "rock"], ["民谣", "folk"], ["钢琴", "piano"], ["古琴", "古琴"]];

export function OnlineMusicSearch({ active }: { active: boolean }) {
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection>("all");
  const [results, setResults] = useState<Results>(() => emptyResults());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<OnlineMusic | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const state = useMusic();
  const request = useRef(0);
  const mounted = useRef(true);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++request.current; }; }, []);
  useEffect(() => { if (!active || state.playing) audio.current?.pause(); }, [active, state.playing]);

  async function search(value: string, append = false, filter = selection) {
    const text = value.trim();
    if (!text) { setError("请输入歌曲、歌手或风格关键词，也可以点击下方风格探索。"); return; }
    const targets = MUSIC_PROVIDERS.filter(p => (filter === "all" || p.id === filter) && (!append || results.next[p.id] != null));
    if (!targets.length) return;
    const token = ++request.current;
    setLoading(true); setError("");
    if (!append) { setPreview(null); setResults(emptyResults(text)); }
    setResults(previous => ({ ...previous, status: { ...previous.status, ...Object.fromEntries(targets.map(p => [p.id, "搜索中…"])) } }));
    await Promise.allSettled(targets.map(async provider => {
      try {
        const response = await searchMusicProvider(provider.id, text, append ? results.next[provider.id] ?? 0 : 0);
        if (token !== request.current) return;
        setResults(previous => {
          const ids = new Set(previous.items.map(onlineMusicId));
          const items = [...previous.items, ...response.items.filter(item => {
            const id = onlineMusicId(item);
            if (ids.has(id)) return false;
            ids.add(id); return true;
          })];
          const order = (item: OnlineMusic) => MUSIC_PROVIDERS.findIndex(p => p.id === (item.provider ?? "commons"));
          items.sort((a, b) => order(a) - order(b));
          return { ...previous, items, next: { ...previous.next, [provider.id]: response.nextOffset },
            status: { ...previous.status, [provider.id]: `${items.filter(item => (item.provider ?? "commons") === provider.id).length} 个结果` },
            warnings: { ...previous.warnings, [provider.id]: response.warnings?.join("；") ?? "" } };
        });
      } catch (cause) {
        if (token !== request.current) return;
        setResults(previous => ({ ...previous, next: { ...previous.next, [provider.id]: append ? previous.next[provider.id] ?? 0 : 0 },
          status: { ...previous.status, [provider.id]: "暂不可用" },
          warnings: { ...previous.warnings, [provider.id]: cause instanceof Error ? cause.message : String(cause) } }));
      }
    }));
    if (token === request.current) setLoading(false);
  }
  function submit(event: FormEvent) { event.preventDefault(); void search(query); }
  function chooseSource(value: Selection) { setSelection(value); if (query.trim() || results.query) void search(query.trim() || results.query, false, value); }
  async function importTrack(item: OnlineMusic, play = false) {
    setDownloading(onlineMusicId(item)); setError("");
    try { await useMusic.getState().importOnline(item); if (play) useMusic.getState().play(onlineMusicId(item)); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current) setDownloading(null); }
  }
  async function openSource(item: OnlineMusic) {
    try { if (isTauri()) await invoke("open_reader", { url: item.pageUrl, title: item.title }); else window.open(item.pageUrl, "_blank", "noopener,noreferrer"); }
    catch { setError("无法打开来源页面，请稍后重试。"); }
  }
  const hasMore = Object.values(results.next).some(offset => offset != null);

  return <section className="music-online" aria-label="在线音乐搜索">
    <form className="music-online-form" onSubmit={submit}>
      <label><Search size={18} /><input aria-label="在线搜索关键词" maxLength={120} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索歌名、歌手或风格，发现更多免费音乐" /></label>
      <button className="music-button" type="submit" disabled={loading}>{loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}{loading ? "搜索中…" : "在线搜索"}</button>
    </form>
    <div className="music-source-filters" role="group" aria-label="音源筛选"><button aria-pressed={selection === "all"} className={selection === "all" ? "active" : ""} onClick={() => chooseSource("all")}><Globe2 size={13} />全部音源</button>{MUSIC_PROVIDERS.map(provider => <button key={provider.id} title={provider.description} aria-pressed={selection === provider.id} className={selection === provider.id ? "active" : ""} onClick={() => chooseSource(provider.id)}>{provider.name}</button>)}</div>
    <div className="music-online-suggestions"><span>发现音乐</span>{TOPICS.map(([label, value]) => <button key={value} disabled={loading} onClick={() => { setQuery(value); void search(value); }}>{label}</button>)}</div>
    {!!results.query && <div className="music-provider-status" aria-live="polite">{MUSIC_PROVIDERS.filter(p => results.status[p.id]).map(provider => <div key={provider.id} title={results.warnings[provider.id]} className={results.warnings[provider.id] ? "has-warning" : ""}><span>{provider.name}</span><small>{results.status[provider.id]}</small></div>)}</div>}
    {Object.entries(results.warnings).filter(([, message]) => message).map(([source, message]) => <div className="music-source-warning" key={source}>{MUSIC_PROVIDERS.find(p => p.id === source)?.name}：{message}</div>)}
    {error && <div className="music-alert" role="alert"><span>{error}</span><button aria-label="关闭在线搜索提示" onClick={() => setError("")}><X size={16} /></button></div>}
    {preview && <div className="music-online-preview"><div><Music2 size={17} /><strong>试听：{preview.title}</strong><button className="music-icon" aria-label="关闭试听" onClick={() => setPreview(null)}><X size={16} /></button></div><audio key={onlineMusicId(preview)} ref={audio} controls autoPlay preload="metadata" src={preview.url} onPlay={() => useMusic.setState({ playing: false })} onError={() => setError("此音频暂时无法播放，请检查网络或尝试其他歌曲。")} /></div>}
    {!!results.query && <div className="music-online-summary" aria-live="polite">「{results.query}」· {results.items.length} 个免费可听结果{loading ? " · 继续搜索其他来源…" : ""}</div>}
    <div className="music-online-results" aria-busy={loading}>{results.items.map(item => {
      const id = onlineMusicId(item); const imported = state.tracks.some(track => track.id === id); const streaming = item.downloadable === false;
      return <article key={id} className="music-online-result">
        <div className={`music-song-cover ${streaming ? "music-stream-cover" : ""}`}>{streaming ? <Radio size={20} /> : <Music2 size={20} />}</div>
        <div className="music-online-info"><h3 title={item.filename}>{item.title}</h3><p title={item.artist}>{item.artist}</p><div><span className="music-source-badge">{musicProviderName(item)}</span><span className="music-format">{item.format}</span><span>{item.duration ? musicTime(item.duration) : "时长未知"}</span><span>{streaming ? "免费在线播放" : `${(item.size / 1024 / 1024).toFixed(1)} MB · 可下载`}</span>{item.genre && <span>{item.genre}</span>}</div><button className="music-source-link" title={item.license} onClick={() => void openSource(item)}><ExternalLink size={11} />{item.license} · 来源详情</button></div>
        <div className="music-online-actions"><button className="music-button music-button-outline" onClick={() => { setError(""); setPreview(item); }}>试听</button><button className="music-button" disabled={imported || state.importing || state.loading} onClick={() => void importTrack(item)}>{imported ? <Check size={14} /> : downloading === id ? <Loader2 size={14} className="animate-spin" /> : streaming ? <Radio size={14} /> : <Download size={14} />}{imported ? "已加入" : downloading === id ? streaming ? "加入中…" : "下载中…" : streaming ? "加入在线曲库" : "下载入库"}</button>{streaming && <button className="music-stream-play" disabled={state.importing || state.loading} onClick={() => void importTrack(item, true)}>免费收听</button>}</div>
      </article>;
    })}</div>
    {!!results.query && !loading && !results.items.length && <div className="music-empty"><div><Search size={28} /></div><h3>还没有找到可播放的音乐</h3><p>试试歌手英文名或上方风格标签，也可以切换音源后再搜索。</p></div>}
    {hasMore && <button className="music-online-more music-button music-button-outline" disabled={loading} onClick={() => void search(results.query, true)}>{loading ? "正在加载…" : "加载更多 / 重试来源"}</button>}
    <p className="music-codec-note">Audius 提供免费在线播放，加入在线曲库后仍需联网；开放授权录音可下载入库离线播放（单文件最大 80 MB）。已过滤需要付费或授权的 Audius 结果。</p>
  </section>;
}
