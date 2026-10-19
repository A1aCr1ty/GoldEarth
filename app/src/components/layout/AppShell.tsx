import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { useUiScale } from "@/lib/uiScale";
import { normalizeAppearance, setAppearance } from "@/lib/appearance";
import { tauri } from "@/lib/tauri";
export function AppShell() {
  // 整个界面跟着窗口大小缩放
  useUiScale();
  // 外观以 settings.json 为准：首帧先用本地缓存顶上，拿到设置再校正一次
  useEffect(() => {
    void tauri
      .getSettings()
      .then((s) =>
        setAppearance(
          normalizeAppearance({
            theme: s.theme,
            accent: s.accent,
            font: s.font,
            fontScale: s.fontScale,
          })
        )
      )
      .catch(() => {
        // 读不到设置就用缓存/默认值，不影响使用
      });
  }, []);
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* 侧栏跟着窗口缩，宽度还能拖动、折叠成图标栏，见 Sidebar */}
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
