import { create } from "zustand";
import { tauri } from "@/lib/tauri";
import type { DailyTravel } from "@/types";

interface TravelState {
  report: DailyTravel | null;
  loading: boolean;
  error?: string;
  load: (date: string, force?: boolean) => Promise<void>;
}
let requestId = 0;
let pending: { date: string; task: Promise<void> } | null = null;
let lastCompletedAt = 0;

export const useTravel = create<TravelState>((set, get) => ({
  report: null, loading: false,
  load(date, force = false) {
    // Retry offline snapshots after a short cooldown; concurrent refreshes share
    // the same request rather than queueing behind the backend load lock.
    if (pending?.date === date) return pending.task;
    const saved = get().report;
    if (!force && saved?.date === date && (saved.status !== "offline" || Date.now() - lastCompletedAt < 30_000)) return Promise.resolve();
    const id = ++requestId;
    set({ loading: true, error: undefined });
    const task = tauri.dailyTravel(date, force).then((report) => {
      if (id === requestId) { lastCompletedAt = Date.now(); set({ report }); }
    }).catch((error) => {
      if (id === requestId) set({ error: String(error) });
    }).finally(() => {
      if (id === requestId) { set({ loading: false }); pending = null; }
    });
    pending = { date, task };
    return task;
  },
}));
