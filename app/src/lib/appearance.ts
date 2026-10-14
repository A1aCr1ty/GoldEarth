/**
 * 外观设置：主题模式（浅色 / 深色 / 跟随系统）、主题色、字体、字号倍数。
 *
 * 颜色不走组件里的 class，而是把选中的主题色写进 index.css 里那套 CSS 变量
 * （--primary / --primary-foreground / --ring），所以任何用 bg-primary 之类的
 * 组件都会跟着变，不用逐个改。
 *
 * 深色模式靠 <html class="dark">：tailwind.config.js 声明的是 darkMode: ["class"]，
 * md-editor-rt 也是监听这个 class 切主题的，所以一处生效处处生效。
 *
 * 字号倍数交给 uiScale 一起算：根字号 = 基准字号 × 字号倍数 × 窗口缩放，
 * 拖窗口和改字号互不覆盖。
 */
import { useSyncExternalStore } from "react";
import { MAX_FONT_SCALE, MIN_FONT_SCALE, setBaseFontScale } from "@/lib/uiScale";

/** 字号上下限只在 uiScale 里定义一份，这里转发出去方便设置页取用 */
export { MAX_FONT_SCALE, MIN_FONT_SCALE };

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface Appearance {
  theme: ThemeMode;
  accent: string;
  font: string;
  fontScale: number;
}

/** 从 settings.json / localStorage 读回来的原始值：字段可能缺失、可能是脏值 */
export type AppearanceInput = Partial<Record<keyof Appearance, unknown>>;

interface AccentPalette {
  primary: string;
  /** 压在 primary 上的文字色，要和 primary 一起换，否则会看不清 */
  onPrimary: string;
}

export interface AccentPreset {
  key: string;
  label: string;
  light: AccentPalette;
  dark: AccentPalette;
}

/** 取值是 HSL 三元组，和 index.css 里 --primary 的写法一致（不带 hsl() 外壳） */
export const ACCENT_PRESETS: AccentPreset[] = [
  {
    key: "default",
    label: "默认",
    // 和 index.css 的默认值一模一样，选它等于回到原样
    light: { primary: "222.2 47.4% 11.2%", onPrimary: "210 40% 98%" },
    dark: { primary: "210 40% 98%", onPrimary: "222.2 47.4% 11.2%" },
  },
  {
    key: "blue",
    label: "蓝色",
    light: { primary: "221.2 83.2% 55%", onPrimary: "210 40% 98%" },
    dark: { primary: "217.2 91.2% 62%", onPrimary: "222.2 47.4% 11.2%" },
  },
  {
    key: "violet",
    label: "紫色",
    light: { primary: "262.1 83.3% 60%", onPrimary: "210 40% 98%" },
    dark: { primary: "263.4 70% 68%", onPrimary: "222.2 47.4% 11.2%" },
  },
  {
    key: "teal",
    label: "青色",
    light: { primary: "173.4 80.4% 28%", onPrimary: "210 40% 98%" },
    dark: { primary: "172.5 66% 62%", onPrimary: "222.2 47.4% 11.2%" },
  },
  {
    key: "green",
    label: "绿色",
    light: { primary: "142.1 70.6% 30%", onPrimary: "210 40% 98%" },
    dark: { primary: "142.1 70.6% 62%", onPrimary: "222.2 47.4% 11.2%" },
  },
  {
    key: "amber",
    label: "琥珀",
    light: { primary: "32.1 94.6% 35%", onPrimary: "210 40% 98%" },
    dark: { primary: "37.7 92.1% 62%", onPrimary: "222.2 47.4% 11.2%" },
  },
  {
    key: "rose",
    label: "玫瑰",
    light: { primary: "346.8 77.2% 49%", onPrimary: "210 40% 98%" },
    dark: { primary: "346.8 77.2% 63%", onPrimary: "222.2 47.4% 11.2%" },
  },
];

export interface FontPreset {
  key: string;
  label: string;
  /** 设置页里的一句话说明 */
  hint: string;
  /** 直接写进 --app-font 的字体栈 */
  stack: string;
}

export const FONT_PRESETS: FontPreset[] = [
  {
    key: "system",
    label: "系统默认",
    hint: "跟着操作系统走",
    stack:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    key: "sans",
    label: "黑体",
    hint: "微软雅黑 / 苹方，屏幕阅读最稳",
    stack: '"Microsoft YaHei", "PingFang SC", "Source Han Sans SC", "Noto Sans SC", system-ui, sans-serif',
  },
  {
    key: "serif",
    label: "宋体",
    hint: "衬线，适合成篇的文字",
    stack:
      'Georgia, "Times New Roman", "Source Han Serif SC", "Noto Serif SC", "Songti SC", SimSun, serif',
  },
  {
    key: "kai",
    label: "楷体",
    hint: "手写感，看笔记更柔和",
    stack: '"Kaiti SC", KaiTi, STKaiti, "Noto Serif SC", serif',
  },
  {
    key: "mono",
    label: "等宽",
    hint: "代码、数字对齐",
    stack: 'ui-monospace, "Cascadia Mono", Consolas, "JetBrains Mono", "Courier New", monospace',
  },
];

export const THEME_MODES: { key: ThemeMode; label: string }[] = [
  { key: "light", label: "浅色" },
  { key: "dark", label: "深色" },
  { key: "system", label: "跟随系统" },
];

/** 字号倍数档位；可取范围由 MIN_FONT_SCALE / MAX_FONT_SCALE 定，和后端同值 */
export const FONT_SCALES = [
  { value: 0.9, label: "小" },
  { value: 1, label: "标准" },
  { value: 1.1, label: "大" },
  { value: 1.2, label: "特大" },
];

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "system",
  accent: "default",
  font: "system",
  fontScale: 1,
};

const themeKeys = THEME_MODES.map((mode) => mode.key);
const accentKeys = ACCENT_PRESETS.map((preset) => preset.key);
const fontKeys = FONT_PRESETS.map((preset) => preset.key);

/** 白名单校验：不在名单里的值退回默认，避免脏值被写进 CSS 变量 */
function pickKey(allowed: string[], value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().toLowerCase();
  return allowed.includes(trimmed) ? trimmed : fallback;
}

export function normalizeFontScale(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_APPEARANCE.fontScale;
  const clamped = Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, numeric));
  return Math.round(clamped * 100) / 100;
}

export function normalizeAppearance(input?: AppearanceInput | null): Appearance {
  const raw = input ?? {};
  return {
    theme: pickKey(themeKeys, raw.theme, DEFAULT_APPEARANCE.theme) as ThemeMode,
    accent: pickKey(accentKeys, raw.accent, DEFAULT_APPEARANCE.accent),
    font: pickKey(fontKeys, raw.font, DEFAULT_APPEARANCE.font),
    fontScale: normalizeFontScale(raw.fontScale),
  };
}

export function resolveTheme(theme: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === "system") return systemPrefersDark ? "dark" : "light";
  return theme === "dark" ? "dark" : "light";
}

/** 选中外观要写进 DOM 的 CSS 变量：主题色三件套 + 字体 */
export function appearanceVars(
  appearance: Appearance,
  resolved: ResolvedTheme
): Record<string, string> {
  const preset =
    ACCENT_PRESETS.find((item) => item.key === appearance.accent) ?? ACCENT_PRESETS[0];
  const palette = resolved === "dark" ? preset.dark : preset.light;
  const font = FONT_PRESETS.find((item) => item.key === appearance.font) ?? FONT_PRESETS[0];
  return {
    "--primary": palette.primary,
    "--primary-foreground": palette.onPrimary,
    // 焦点描边跟着主题色走，不然换了色只有按钮变、光标还是蓝的
    "--ring": palette.primary,
    "--app-font": font.stack,
  };
}

/** 设置页里的色块：按当前深浅色取对应的那份 primary */
export function accentSwatch(preset: AccentPreset, resolved: ResolvedTheme = "light"): string {
  const palette = resolved === "dark" ? preset.dark : preset.light;
  return `hsl(${palette.primary})`;
}

/** 设置页色块上那个对勾的颜色：跟 primary 配套的前景色 */
export function accentSwatchText(preset: AccentPreset, resolved: ResolvedTheme = "light"): string {
  const palette = resolved === "dark" ? preset.dark : preset.light;
  return `hsl(${palette.onPrimary})`;
}

const CACHE_KEY = "goldearth.appearance";

let state: Appearance = DEFAULT_APPEARANCE;
let resolvedState: ResolvedTheme = "light";
const listeners = new Set<() => void>();

export function currentAppearance(): Appearance {
  return state;
}

/** 当前实际生效的深浅色（跟随系统时就是系统的值） */
export function currentResolvedTheme(): ResolvedTheme {
  return resolvedState;
}

export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * 落到 DOM：html 上的 dark class、颜色变量、字体变量。
 * 字号倍数交给 setBaseFontScale —— 它会把根字号按「基准 × 倍数 × 窗口缩放」重算。
 */
export function applyAppearance(appearance: AppearanceInput, root?: HTMLElement | null): Appearance {
  const next = normalizeAppearance(appearance);
  const resolved = resolveTheme(next.theme, systemPrefersDark());
  const target = root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (target) {
    target.classList.toggle("dark", resolved === "dark");
    // color-scheme 让原生滚动条 / 输入框 / 下拉跟着变，否则深色下会闪白条
    target.style.colorScheme = resolved;
    const vars = appearanceVars(next, resolved);
    for (const name of Object.keys(vars)) {
      target.style.setProperty(name, vars[name]);
    }
  }
  resolvedState = resolved;
  state = next;
  setBaseFontScale(next.fontScale);
  for (const listener of listeners) listener();
  return next;
}

/** 应用外观并记进本地缓存（首帧先用缓存渲染，避免白闪） */
export function setAppearance(appearance: AppearanceInput): Appearance {
  const next = applyAppearance(appearance);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    }
  } catch {
    // 隐私模式等写不进去就算了：真实值存在 settings.json 里，缓存丢了只是首帧会闪
  }
  return next;
}

/** 启动时先读缓存：settings.json 要等后端返回，缓存能让首帧就是正确的深浅色 */
export function readCachedAppearance(): Appearance {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_APPEARANCE;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? normalizeAppearance(JSON.parse(raw)) : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

let watchingSystem = false;

/** 选了「跟随系统」时跟着系统深浅色走；挂一次就够，重复调用无副作用 */
export function installSystemThemeWatcher(): void {
  if (watchingSystem) return;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  watchingSystem = true;
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const sync = () => {
    if (state.theme === "system") applyAppearance(state);
  };
  if (typeof query.addEventListener === "function") query.addEventListener("change", sync);
  else if (typeof query.addListener === "function") query.addListener(sync);
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribeAppearance, currentAppearance, currentAppearance);
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeAppearance, currentResolvedTheme, currentResolvedTheme);
}
