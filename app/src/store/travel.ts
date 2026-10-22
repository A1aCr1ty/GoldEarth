import { create } from "zustand";
import { tauri } from "@/lib/tauri";
import type { DailyTravel } from "@/types";

interface TravelState {
  report: DailyTravel | null;
  loading: boolean;
  error?: string;
  load: (date: string, force?: boolean, days?: number) => Promise<void>;
}
let requestId = 0;
let pending: { key: string; task: Promise<void> } | null = null;
const requests = new Map<string, Promise<DailyTravel>>();
let lastCompletedAt = 0;

export const useTravel = create<TravelState>((set, get) => ({
  report: null, loading: false,
  load(date, force = false, days = 3) {
    const key = `${date}:${days}`;
    // Retry offline snapshots after a short cooldown; concurrent refreshes share
    // the same request rather than queueing behind the backend load lock.
    if (pending?.key === key) return pending.task;
    const saved = get().report;
    if (!force && saved?.date === date && saved.destination?.days === days && (saved.status !== "offline" || Date.now() - lastCompletedAt < 30_000)) {
      requestId++; pending = null; set({ loading: false, error: undefined });
      return Promise.resolve();
    }
    const id = ++requestId;
    set({ loading: true, error: undefined });
    let request = requests.get(key);
    if (!request) {
      request = tauri.dailyTravel(date, force, days).finally(() => requests.delete(key));
      requests.set(key, request);
    }
    const task = request.then((report) => {
      if (id === requestId) { lastCompletedAt = Date.now(); set({ report }); }
    }).catch((error) => {
      if (id === requestId) set({ error: String(error) });
    }).finally(() => {
      if (id === requestId) { set({ loading: false }); pending = null; }
    });
    pending = { key, task };
    return task;
  },
}));
