import { create } from "zustand";
import { MusicTrack, PlayMode, musicFileInfo, nextTrackId, readMusic, saveMusic } from "@/lib/music";
import { OnlineMusic, onlineMusicId } from "@/lib/onlineMusic";
import { downloadCatalogMusic, musicProviderName } from "@/lib/musicCatalog";

interface MusicState {
  tracks: MusicTrack[];
  currentId: string | null;
  playing: boolean;
  loading: boolean;
  importing: boolean;
  error: string;
  mode: PlayMode;
  volume: number;
  position: number;
  seekTo: number | null;
  queueOpen: boolean;
  initialize: () => Promise<void>;
  importFiles: (files: File[]) => Promise<void>;
  importOnline: (item: OnlineMusic) => Promise<void>;
  play: (id: string) => void;
  toggle: () => void;
  next: (direction?: number, ended?: boolean) => void;
  favorite: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}
let initializing: Promise<void> | undefined;
export const useMusic = create<MusicState>((set, get) => ({
  tracks: [], currentId: null, playing: false, loading: true, importing: false,
  error: "", mode: "loop", volume: 0.7, position: 0, seekTo: null, queueOpen: false,
  initialize() {
    if (!initializing) initializing = readMusic().then(tracks => set({ tracks, loading: false })).catch(() => {
      set({ loading: false, error: "音乐库读取失败，请重新打开应用后重试。" });
      initializing = undefined;
    });
    return initializing;
  },
  async importFiles(files) {
    if (get().importing) return;
    set({ importing: true, error: "" });
    try {
      await get().initialize();
      const existing = new Set(get().tracks.map(track => track.id));
      const tracks: MusicTrack[] = [];
      let skipped = 0;
      for (const file of files) {
        if (!/\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|webm|aiff|aif)$/i.test(file.name)) { skipped++; continue; }
        const id = `${file.name}:${file.size}:${file.lastModified}`;
        if (existing.has(id)) continue;
        existing.add(id);
        tracks.push({ id, ...musicFileInfo(file.name), filename: file.name, size: file.size, duration: 0, favorite: false, blob: file });
      }
      await saveMusic(tracks);
      set(state => ({ tracks: [...state.tracks, ...tracks], error: skipped ? `已跳过 ${skipped} 个非音频文件。` : "" }));
    } catch { set({ error: "导入失败，可能是本地存储空间不足。请减少文件数量后重试。" }); }
    finally { set({ importing: false }); }
  },
  async importOnline(item) {
    if (get().importing) throw new Error("已有文件正在导入，请稍后重试。");
    set({ importing: true });
    try {
      await get().initialize();
      const id = onlineMusicId(item);
      if (get().tracks.some(track => track.id === id)) return;
      const streaming = item.provider === "audius" && item.downloadable === false;
      if (streaming && (!item.sourceId || !/^[A-Za-z0-9]+$/.test(item.sourceId))) throw new Error("无效在线歌曲编号。");
      const blob = streaming ? null : await downloadCatalogMusic(item);
      const track: MusicTrack = { id, title: item.title, artist: item.artist, filename: item.filename,
        format: item.format, size: blob?.size ?? 0, duration: item.duration, favorite: false, blob,
        ...(streaming ? { streamUrl: `https://api.audius.co/v1/tracks/${item.sourceId}/stream?app_name=GoldEarth` } : {}),
        source: { name: musicProviderName(item), url: item.pageUrl, license: item.license } };
      await saveMusic([track]);
      set(state => ({ tracks: [...state.tracks, track] }));
    } finally { set({ importing: false }); }
  },
  play(id) { if (get().tracks.some(track => track.id === id)) set({ currentId: id, playing: true, error: "" }); },
  toggle() {
    if (!get().currentId && get().tracks.length) get().play(get().tracks[0].id);
    else if (get().currentId) set(state => ({ playing: !state.playing, error: "" }));
  },
  next(direction = 1, ended = false) {
    const state = get();
    const id = nextTrackId(state.tracks.map(track => track.id), state.currentId, state.mode, direction, ended);
    if (id) set({ currentId: id, position: 0, seekTo: 0, playing: true, error: "" });
  },
  async favorite(id) {
    const track = get().tracks.find(track => track.id === id);
    if (!track) return;
    const updated = { ...track, favorite: !track.favorite };
    try { await saveMusic([updated]); set(state => ({ tracks: state.tracks.map(t => t.id === id ? { ...t, favorite: updated.favorite } : t) })); }
    catch { set({ error: "收藏保存失败，请重试。" }); }
  },
  async remove(id) {
    try {
      await saveMusic([], id);
      set(state => ({ tracks: state.tracks.filter(t => t.id !== id), ...(state.currentId === id ? { currentId: null, playing: false, position: 0 } : {}) }));
    } catch { set({ error: "移除失败，请重试。" }); }
  },
}));
