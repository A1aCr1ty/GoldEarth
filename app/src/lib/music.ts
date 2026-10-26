export type PlayMode = "loop" | "single" | "shuffle";
export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  filename: string;
  format: string;
  size: number;
  duration: number;
  favorite: boolean;
  blob: Blob;
}

export const AUDIO_ACCEPT = ".mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.webm,.aiff,.aif";
export function musicFileInfo(name: string) {
  const format = name.split(".").pop()?.toUpperCase() || "AUDIO";
  const stem = name.replace(/\.[^.]+$/, "");
  const parts = stem.split(/\s+-\s+/);
  return { title: parts.length > 1 ? parts.slice(1).join(" - ") : stem, artist: parts.length > 1 ? parts[0] : "未知歌手", format };
}
export function musicTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}
export function nextTrackId(ids: string[], current: string | null, mode: PlayMode, direction = 1, ended = false, random = Math.random): string | null {
  if (!ids.length) return null;
  const index = ids.indexOf(current ?? "");
  if (ended && mode === "single" && index >= 0) return ids[index];
  if (mode === "shuffle" && ids.length > 1 && index >= 0) {
    const others = ids.filter(id => id !== current);
    return others[Math.min(others.length - 1, Math.floor(random() * others.length))];
  }
  return ids[index < 0 ? 0 : (index + direction + ids.length) % ids.length];
}

let database: Promise<IDBDatabase> | undefined;
function openMusicDB() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("goldearth-music", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("tracks", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("音乐库正在被其他窗口使用，请关闭其他窗口后重试"));
  }).catch(error => { database = undefined; throw error; });
  return database;
}
export async function readMusic(): Promise<MusicTrack[]> {
  const db = await openMusicDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction("tracks").objectStore("tracks").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveMusic(tracks: MusicTrack[], removeId?: string) {
  const db = await openMusicDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("tracks", "readwrite");
    const store = transaction.objectStore("tracks");
    tracks.forEach(track => store.put(track));
    if (removeId) store.delete(removeId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("音乐保存失败"));
  });
}
