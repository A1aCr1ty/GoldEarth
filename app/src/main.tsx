import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyUiScale, computeUiScale } from "@/lib/uiScale";
import { applyAppearance, installSystemThemeWatcher, readCachedAppearance } from "@/lib/appearance";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// 外观先用上次的缓存渲染（选了深色就不会先闪一下白），随后 AppShell 会用 settings.json 校正
applyAppearance(readCachedAppearance());
installSystemThemeWatcher();
// 再按当前窗口定一次缩放，免得首帧用 1x 画完再跳（AppShell 里的 useUiScale 只管后续 resize）
applyUiScale(computeUiScale(window.innerWidth, window.innerHeight));

// 事件回调里抛的错、未处理的 Promise 拒绝不会让整棵树消失，
// 但会静悄悄地丢掉信息。只记到控制台，不用它们去覆盖界面。
window.addEventListener("error", (e) => {
  console.error("[GoldEarth] 未捕获错误", e.error ?? e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[GoldEarth] 未处理的 Promise 拒绝", (e as PromiseRejectionEvent).reason);
});

// 渲染期的异常必须兜住：一旦漏出去 React 会卸载整棵树，
// 窗口就成了一片空白，既看不到提示也刷新不出来。
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
