import { invoke, isTauri } from "@tauri-apps/api/core";
import { MAX_ONLINE_AUDIO_BYTES, OnlineMusic, OnlineMusicResults, downloadOnlineMusic, isAudioBytes, searchOnlineMusic } from "./onlineMusic";

export type MusicProvider = "audius" | "archive" | "commons";
export const MUSIC_PROVIDERS: { id: MusicProvider; name: string; description: string }[] = [
  { id: "audius", name: "Audius", description: "独立音乐 · 免费在线播放" },
  { id: "archive", name: "Internet Archive", description: "开放授权录音 · 可下载" },
  { id: "commons", name: "Wikimedia Commons", description: "公共音频 · 可下载" },
];
export const musicProviderName = (item: OnlineMusic) => MUSIC_PROVIDERS.find(p => p.id === (item.provider ?? "commons"))?.name ?? "公开音频";

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(" / ");
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) : "";
}
export function parseAudiusMusic(data: any, offset = 0): OnlineMusicResults {
  if (!Array.isArray(data?.data)) throw new Error("Audius 返回了无效数据，请重试。");
  const items: OnlineMusic[] = [];
  for (const track of data.data) {
    if (!/^[A-Za-z0-9]+$/.test(track.id ?? "") || track.is_available !== true || track.is_streamable !== true
        || track.is_stream_gated !== false || track.access?.stream !== true || track.is_delete || track.is_unlisted) continue;
    const pageUrl = `https://audius.co${typeof track.permalink === "string" && /^\/[A-Za-z0-9_\-/]+$/.test(track.permalink) ? track.permalink : `/tracks/${track.id}`}`;
    const streamUrl = `https://api.audius.co/v1/tracks/${track.id}/stream?app_name=GoldEarth`;
    items.push({ provider: "audius", sourceId: track.id, pageId: 0, title: text(track.title) || "未命名歌曲",
      artist: text(track.user?.name) || "未知歌手", filename: `${text(track.title) || track.id}.mp3`, format: "MP3",
      mime: "audio/mpeg", size: 0, duration: Number(track.duration) || 0, url: streamUrl, streamUrl, pageUrl,
      license: text(track.license) || "授权信息见来源页", downloadable: false, genre: text(track.genre) });
  }
  return { items, nextOffset: data.data.length >= 20 && offset + 20 <= 10000 ? offset + 20 : null };
}

function licenseText(value: unknown): string | null {
  for (const candidate of Array.isArray(value) ? value : [value]) {
    try {
      const url = new URL(String(candidate));
      if (!["http:", "https:"].includes(url.protocol) || !["creativecommons.org", "www.creativecommons.org"].includes(url.hostname)) continue;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "licenses" && parts[1]) return `CC ${parts[1].toUpperCase()} ${parts[2] ?? ""}`.trim();
      if (parts[0] === "publicdomain") return parts[1] === "zero" ? "CC0" : "Public domain";
    } catch { /* Ignore invalid license URLs. */ }
  }
  return null;
}
const trueValue = (value: unknown) => value === true || value === "true";
function durationValue(value: unknown): number {
  const pieces = String(value ?? "").split(":").map(Number);
  const seconds = pieces.reduce((total, part) => total * 60 + part, 0);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
}

export function parseArchiveMusic(data: any): OnlineMusicResults {
  if (!Array.isArray(data?.records)) throw new Error("Internet Archive 返回了无效数据，请重试。");
  const items: OnlineMusic[] = [];
  for (const record of data.records) {
    const metadata = record.metadata;
    const identifier = metadata?.identifier;
    const license = licenseText(metadata?.licenseurl);
    if (!metadata || !license || !/^[A-Za-z0-9_.-]{1,256}$/.test(identifier ?? "") || [".", ".."].includes(identifier)
        || trueValue(record.is_dark) || trueValue(metadata.nodownload) || trueValue(metadata["access-restricted-item"])) continue;
    const files = Array.isArray(record.files) ? [...record.files] : [];
    const rank = (name: string) => ({ mp3: 0, ogg: 1, oga: 1, flac: 2, m4a: 3, wav: 4 }[name.split(".").pop()?.toLowerCase() ?? ""] ?? 5);
    files.sort((a, b) => rank(String(a.name)) - rank(String(b.name)));
    const seen = new Set<string>();
    let count = 0;
    for (const file of files) {
      const filename: string = typeof file.name === "string" ? file.name : "";
      const format = filename.split(".").pop()?.toUpperCase() ?? "";
      const size = Number(file.size);
      if (!/^(MP3|WAV|FLAC|M4A|AAC|OGG|OGA|OPUS|WEBM|AIFF|AIF)$/.test(format)
          || filename.split("/").some(part => part === "." || part === "..") || trueValue(file.private)
          || !Number.isFinite(size) || size <= 0 || size > MAX_ONLINE_AUDIO_BYTES) continue;
      const key = String(file.original || filename).replace(/\.[^.]+$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      const mime = format === "MP3" ? "audio/mpeg" : ["OGG", "OGA", "OPUS"].includes(format) ? "audio/ogg" : `audio/${format.toLowerCase()}`;
      items.push({ provider: "archive", sourceId: JSON.stringify([identifier, filename]), archiveId: identifier, pageId: 0,
        title: text(file.title) || filename.replace(/\.[^.]+$/, ""), artist: text(file.artist || file.creator || metadata.creator) || "未知演奏者",
        filename, format, mime, size, duration: durationValue(file.length), genre: text(file.genre),
        url: `https://archive.org/download/${encodeURIComponent(identifier)}/${filename.split("/").map(encodeURIComponent).join("/")}`,
        pageUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`, license, downloadable: true });
      if (++count >= 12) break;
    }
  }
  return { items, nextOffset: Number.isSafeInteger(data.nextOffset) && data.nextOffset >= 0 && data.nextOffset <= 10000 ? data.nextOffset : null,
    warnings: Array.isArray(data.warnings) ? [...new Set<string>(data.warnings.map(String))] : [] };
}

async function publicJson(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`音源暂不可用（${response.status}），请重试。`);
  return response.json();
}
async function browserArchiveSearch(query: string, offset: number) {
  const escaped = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const filter = `mediatype:audio AND ("${escaped}") AND licenseurl:(*creativecommons.org*) AND (collection:netlabels OR collection:audio_music OR collection:opensource_audio)`;
  const params = new URLSearchParams({ q: filter, "fl[]": "identifier", rows: "6", page: String(Math.floor(offset / 6) + 1), "sort[]": "downloads desc", output: "json" });
  const data = await publicJson(`https://archive.org/advancedsearch.php?${params}`);
  if (!Array.isArray(data.response?.docs)) throw new Error("录音搜索响应不完整。");
  const records: any[] = [];
  const warnings: string[] = [];
  const ids = data.response.docs.map((doc: any) => doc.identifier).filter((id: unknown) => typeof id === "string" && /^[A-Za-z0-9_.-]{1,256}$/.test(id));
  for (let i = 0; i < ids.length; i += 3) {
    const batch = await Promise.allSettled(ids.slice(i, i + 3).map((id: string) => publicJson(`https://archive.org/metadata/${id}`)));
    for (const result of batch) {
      if (result.status === "fulfilled") records.push(result.value);
      else warnings.push("部分录音暂时无法读取，可加载更多或重试");
    }
  }
  return { records, nextOffset: offset + 6 < Number(data.response.numFound) ? offset + 6 : null, warnings };
}

export async function searchMusicProvider(provider: MusicProvider, query: string, offset = 0): Promise<OnlineMusicResults> {
  query = query.trim();
  if (!query || query.length > 120) throw new Error("请输入 1–120 字的搜索词。");
  if (provider === "commons") return searchOnlineMusic(query, offset);
  const data = isTauri() ? await invoke("music_catalog_search", { source: provider, query, offset })
    : provider === "audius" ? await publicJson(`https://api.audius.co/v1/tracks/search?${new URLSearchParams({ query, limit: "20", offset: String(offset), app_name: "GoldEarth" })}`)
      : await browserArchiveSearch(query, offset);
  return provider === "audius" ? parseAudiusMusic(data, offset) : parseArchiveMusic(data);
}

export async function downloadCatalogMusic(item: OnlineMusic): Promise<Blob> {
  if (!item.provider || item.provider === "commons") return downloadOnlineMusic(item);
  if (item.provider !== "archive" || !item.archiveId) throw new Error("此歌曲支持免费在线播放，不能下载为本地文件。");
  let buffer: ArrayBuffer;
  if (isTauri()) buffer = await invoke<ArrayBuffer>("music_archive_download", { identifier: item.archiveId, filename: item.filename });
  else {
    const data = await publicJson(`https://archive.org/metadata/${encodeURIComponent(item.archiveId)}`);
    // Resolve the exact file, even if it is beyond the per-record search result limit.
    const record = { ...data, files: Array.isArray(data.files) ? data.files.filter((file: any) => file.name === item.filename) : [] };
    const fresh = parseArchiveMusic({ records: [record] }).items[0];
    if (!fresh) throw new Error("录音已下架、限制下载或超过 80 MB。");
    const response = await fetch(fresh.url, { signal: AbortSignal.timeout(90000) });
    if (!response.ok || !response.body) throw new Error("录音下载失败，请重试。");
    if (Number(response.headers.get("content-length")) > MAX_ONLINE_AUDIO_BYTES) { await response.body.cancel(); throw new Error("录音超过 80 MB。"); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) { const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > MAX_ONLINE_AUDIO_BYTES) throw new Error("录音超过 80 MB。"); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(size); let cursor = 0;
    for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
    buffer = bytes.buffer;
  }
  if (buffer.byteLength > MAX_ONLINE_AUDIO_BYTES || !isAudioBytes(new Uint8Array(buffer))) throw new Error("下载内容不是有效音频，未加入曲库。");
  return new Blob([buffer], { type: item.mime });
}
