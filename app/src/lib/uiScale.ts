/**
 * 全局 UI 缩放：让界面跟着窗口大小自己缩放。
 *
 * 原理：Tailwind 的尺寸、间距、圆角、字号全是 rem，所以只改根字号
 * （`html { font-size }`）就能整体等比缩放，而且滚动、flex、grid 都按缩放后的
 * 尺寸参与布局计算，不会像 `transform: scale()` 那样把布局和绘制拆开。
 *
 * 图表是例外：echarts 的 fontSize / grid 边距是 JS 里的 px，取值见
 * `useUiScaleValue()`（按 SCALE_STEP 量化，避免每帧 resize 都重绘 canvas）。
 */
import { useEffect, useSyncExternalStore } from "react";

/** 设计基准＝tauri.conf.json 里的默认窗口大小，这个尺寸下缩放正好是 1 */
export const REFERENCE_WIDTH = 1200;
export const REFERENCE_HEIGHT = 780;
/** 缩放下限：再小的窗口也不低于这个比例，免得字小到看不清 */
export const MIN_SCALE = 0.8;
/** 缩放上限：大屏上适度放大，免得字大到一屏放不下几行 */
export const MAX_SCALE = 1.25;
/** 根字号基准（浏览器默认 16px） */
export const BASE_FONT_SIZE = 16;
/** 字号倍数的上下限：和后端 models.rs 里的 MIN_FONT_SCALE / MAX_FONT_SCALE 一致 */
export const MIN_FONT_SCALE = 0.85;
export const MAX_FONT_SCALE = 1.35;
/** 订阅用的量化步长：跨过一档才通知，图表就不会每一帧都重绘 */
export const SCALE_STEP = 0.02;

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * 由窗口大小算缩放比例：宽高各算一次取小的，再夹在上下限之间。
 * 只看宽度的话，扁窗口里的内容会被纵向挤掉，所以高度也要参与。
 */
export function computeUiScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1;
  }
  const raw = Math.min(width / REFERENCE_WIDTH, height / REFERENCE_HEIGHT);
  return round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw)), 3);
}

/** 按步长量化，避免浮点抖动把通知打得太碎 */
export function quantizeScale(scale: number, step: number = SCALE_STEP): number {
  if (!Number.isFinite(scale) || step <= 0) return 1;
  return round(Math.round(scale / step) * step, 3);
}

/** 图表里用：把设计稿的 px 换算成当前缩放下的 px */
export function scalePx(px: number, scale: number): number {
  return round(px * scale, 2);
}

const listeners = new Set<() => void>();
let currentScale = 1;
/** 设置页里的字号倍数（0.85 – 1.35），乘在基准字号上 */
let baseFontScale = 1;
/** 最近一次的窗口缩放：改字号倍数时要用它重算根字号 */
let lastScale = 1;

/** 当前的量化缩放值；组件通过 useUiScaleValue() 订阅它 */
export function currentUiScale(): number {
  return currentScale;
}

export function subscribeUiScale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 设置页里的「字号」：根字号 = 基准字号 × 字号倍数 × 窗口缩放。
 * 改完立刻按上次的窗口缩放重算一次，不用等 resize 或重启。
 */
export function setBaseFontScale(value: number): number {
  const next = Number.isFinite(value) && value > 0
    ? round(Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, value)), 2)
    : 1;
  if (next === baseFontScale) return baseFontScale;
  baseFontScale = next;
  applyUiScale(lastScale);
  return baseFontScale;
}

export function getBaseFontScale(): number {
  return baseFontScale;
}

/**
 * 落到 DOM：根字号给未量化的连续值（缩放平滑），
 * 同时把值写进 `--ui-scale` 供别处按需读取；订阅者只收到量化后的值。
 */
export function applyUiScale(scale: number, root?: HTMLElement | null): number {
  const next = Number.isFinite(scale) && scale > 0 ? scale : 1;
  lastScale = next;
  const target = root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (target) {
    target.style.fontSize = `${round(BASE_FONT_SIZE * baseFontScale * next, 2)}px`;
    target.style.setProperty("--ui-scale", `${round(next, 3)}`);
  }
  const quantized = quantizeScale(next);
  if (quantized !== currentScale) {
    currentScale = quantized;
    for (const listener of listeners) listener();
  }
  return quantized;
}

/** 订阅量化后的缩放值，图表这类需要 px 的地方用它重新计算 */
export function useUiScaleValue(): number {
  return useSyncExternalStore(subscribeUiScale, currentUiScale, currentUiScale);
}

/** 挂在应用根部：量一次窗口，之后跟着 resize 走（按帧节流） */
export function useUiScale(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    const sync = () => {
      frame = 0;
      applyUiScale(computeUiScale(window.innerWidth, window.innerHeight));
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(sync);
    };
    sync();
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("resize", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);
}