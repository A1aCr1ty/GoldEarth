import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useUiScale } from "@/lib/uiScale";
import { normalizeAppearance, setAppearance } from "@/lib/appearance";
import { tauri } from "@/lib/tauri";
import { BookOpen, FolderTree, FileText, Bot, LayoutDashboard, Settings as SettingsIcon, TrendingUp } from "lucide-react";
const nav = [
  { to: "/home", label: "天气", icon: LayoutDashboard },
  { to: "/library", label: "知识库", icon: BookOpen },
  { to: "/stocks", label: "股票", icon: TrendingUp },
  { to: "/notes", label: "笔记", icon: FileText },
  { to: "/categories", label: "分类", icon: FolderTree },
  { to: "/agents", label: "Agent", icon: Bot },
  { to: "/settings", label: "设置", icon: SettingsIcon },
];
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
      <aside className="flex w-56 flex-col border-r bg-card">
        <div className="flex h-14 items-center px-4 border-b">
          <span className="text-lg font-semibold tracking-tight">GoldEarth</span>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-muted-foreground">本地优先 · 离线可用</div>
      </aside>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
