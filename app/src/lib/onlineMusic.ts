import { invoke, isTauri } from "@tauri-apps/api/core";

export const MAX_ONLINE_AUDIO_BYTES = 80 * 1024 * 1024;
const API = "https://commons.wikimedia.org/w/api.php";
export interface OnlineMusic {
  provider?: "commons" | "audius" | "archive";
  sourceId?: string;
  archiveId?: string;
  downloadable?: boolean;
  streamUrl?: string;
  genre?: string;
  pageId: number;
  title: string;
  artist: string;
  filename: string;
  format: string;
  mime: string;
  size: number;
  duration: number;
  url: string;
  pageUrl: string;
  license: string;
}
export interface OnlineMusicResults { items: OnlineMusic[]; nextOffset: number | null; warnings?: string[] }

function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/&(?:amp|quot|#39|lt|gt|nbsp);/g, entity => ({
    "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " ",
  }[entity] ?? entity)).replace(/\s+/g, " ").trim().slice(0, 250);
}
export function parseOnlineMusic(data: any): OnlineMusicResults {
  if (!data || typeof data !== "object" || data.error || (!data.query && !("batchcomplete" in data))) {
    throw new Error("在线搜索返回了无效数据，请稍后重试。");
  }
  const pages: any[] = Object.values(data.query?.pages ?? {});
  const items: OnlineMusic[] = [];
  for (const page of pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const info = page.imageinfo?.[0];
    if (!info || !Number.isSafeInteger(page.pageid) || page.pageid <= 0) continue;
    const filename = String(page.title ?? "").replace(/^File:/, "");
    const format = filename.split(".").pop()?.toUpperCase() ?? "";
    if (!/^(MP3|WAV|FLAC|M4A|AAC|OGG|OGA|OPUS|WEBM|AIFF|AIF)$/.test(format)) continue;
    try {
      const url = new URL(info.url);
      if (url.protocol !== "https:" || url.hostname !== "upload.wikimedia.org" || url.username || url.password
          || (url.port && url.port !== "443") || !url.pathname.startsWith("/wikipedia/commons/")) continue;
    } catch { continue; }
    if (!(String(info.mime).startsWith("audio/") || info.mime === "application/ogg")) continue;
    if (!Number.isFinite(info.size) || info.size <= 0 || info.size > MAX_ONLINE_AUDIO_BYTES) continue;
    items.push({
      pageId: page.pageid, title: filename.replace(/\.[^.]+$/, ""), filename, format,
      artist: plainText(info.extmetadata?.Artist?.value) || "未知演奏者",
      license: plainText(info.extmetadata?.LicenseShortName?.value) || "授权信息见来源页",
      mime: info.mime, size: info.size, duration: Number.isFinite(info.duration) ? info.duration : 0,
      url: info.url, pageUrl: `https://commons.wikimedia.org/w/index.php?curid=${page.pageid}`,
    });
  }
  const offset = data.continue?.gsroffset;
  return { items, nextOffset: Number.isSafeInteger(offset) && offset >= 0 && offset <= 10000 ? offset : null };
}

export async function searchOnlineMusic(query: string, offset = 0): Promise<OnlineMusicResults> {
  query = query.trim();
  if (!query || query.length > 120) throw new Error("请输入 1–120 字的歌曲、歌手或风格关键词。");
  if (isTauri()) return parseOnlineMusic(await invoke("music_search", { query, offset }));
  const url = new URL(API);
  url.search = new URLSearchParams({ action: "query", format: "json", origin: "*", generator: "search",
    gsrsearch: `${query} filetype:audio`, gsrnamespace: "6", gsrlimit: "20", gsroffset: String(offset),
    prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiextmetadatalanguage: "zh" }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`音频搜索服务暂不可用（${response.status}），请重试。`);
  return parseOnlineMusic(await response.json());
}

export function isAudioBytes(bytes: Uint8Array) {
  const text = (offset: number, count: number) => String.fromCharCode(...bytes.slice(offset, offset + count));
  return text(0, 3) === "ID3" || ["OggS", "fLaC"].includes(text(0, 4))
    || (text(0, 4) === "RIFF" && text(8, 4) === "WAVE") || text(4, 4) === "ftyp"
    || (text(0, 4) === "FORM" && ["AIFF", "AIFC"].includes(text(8, 4)))
    || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    || (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3);
}

export async function downloadOnlineMusic(item: OnlineMusic): Promise<Blob> {
  let buffer: ArrayBuffer;
  if (isTauri()) buffer = await invoke<ArrayBuffer>("music_download", { pageId: item.pageId });
  else {
    // Re-resolve by page id before fetching; never trust a supplied download address.
    const metadataUrl = new URL(API);
    metadataUrl.search = new URLSearchParams({ action: "query", format: "json", origin: "*", pageids: String(item.pageId),
      prop: "imageinfo", iiprop: "url|size|mime|extmetadata" }).toString();
    const metadata = await fetch(metadataUrl, { signal: AbortSignal.timeout(25000) });
    if (!metadata.ok) throw new Error("无法读取音频文件信息，请重试。");
    const fresh = parseOnlineMusic(await metadata.json()).items.find(track => track.pageId === item.pageId);
    if (!fresh) throw new Error("音频已下架、超过 80 MB 或无法导入，请重新搜索。");
    const response = await fetch(fresh.url, { signal: AbortSignal.timeout(90000) });
    if (!response.ok || !response.body) throw new Error("音频下载失败，请检查网络后重试。");
    if (Number(response.headers.get("content-length")) > MAX_ONLINE_AUDIO_BYTES) throw new Error("音频超过 80 MB。");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_ONLINE_AUDIO_BYTES) throw new Error("音频超过 80 MB。");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let cursor = 0;
    for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
    buffer = bytes.buffer;
  }
  if (buffer.byteLength > MAX_ONLINE_AUDIO_BYTES || !isAudioBytes(new Uint8Array(buffer))) {
    throw new Error("下载内容不是有效音频或超过 80 MB，未加入曲库。");
  }
  return new Blob([buffer], { type: item.mime });
}

export const onlineMusicId = (item: Pick<OnlineMusic, "pageId" | "provider" | "sourceId">) =>
  item.provider && item.provider !== "commons" ? `${item.provider}:${item.sourceId}` : `commons:${item.pageId}`;
