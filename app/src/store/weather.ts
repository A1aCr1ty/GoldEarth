import { create } from "zustand";
import { errText } from "@/lib/errors";
import { tauri } from "@/lib/tauri";
import type { CityOption, WeatherReport } from "@/types";

interface WeatherState {
  report: WeatherReport | null;
  loading: boolean;
  error?: string;
  /** 拉取天气；不传 city 就用设置里保存的城市 */
  load: (city?: string) => Promise<void>;
  /** 选定城市：刷新天气并把选择写回设置 */
  setCity: (city: CityOption) => Promise<void>;
}

export const useWeather = create<WeatherState>((set) => ({
  report: null,
  loading: false,

  async load(city) {
    set({ loading: true });
    try {
      const report = await tauri.weatherReport(city);
      set({ report, error: undefined });
    } catch (e) {
      // 保留上一次的数据，只在还没拿到过数据时显示错误
      set({ error: errText(e) });
    } finally {
      set({ loading: false });
    }
  },

  async setCity(city) {
    set({ loading: true });
    try {
      await tauri.updateSettings({ weatherCity: city.name });
      const report = await tauri.weatherReport(city.name);
      set({ report, error: undefined });
    } catch (e) {
      set({ error: errText(e) });
    } finally {
      set({ loading: false });
    }
  },
}));