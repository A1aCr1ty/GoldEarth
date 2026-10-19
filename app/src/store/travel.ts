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

export const useTravel = create<TravelState>((set, get) => ({
  report: null, loading: false,
  load(date, force = false) {
    if (!force && get().report?.date === date) return Promise.resolve();
    if (!force && pending?.date === date) return pending.task;
    const id = ++requestId;
    set({ loading: true, error: undefined });
    const task = tauri.dailyTravel(date, force).then((report) => {
      if (id === requestId) set({ report });
    }).catch((error) => {
      if (id === requestId) set({ error: String(error) });
    }).finally(() => {
      if (id === requestId) { set({ loading: false }); pending = null; }
    });
    pending = { date, task };
    return task;
  },
}));
