import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useUiScale } from "@/lib/uiScale";
import { normalizeAppearance, setAppearance } from "@/lib/appearance";
import { tauri } from "@/lib/tauri";
import { BookOpen, FolderTree, FileText, Bot, LayoutDashboard, Settings as SettingsIcon, TrendingUp, Compass, Tags, Network, Search, Building2, Car, Gem } from "lucide-react";
const nav = [
  { to: "/home", label: "天气", icon: LayoutDashboard },
  { to: "/explore", label: "冲浪", icon: Compass },
  { to: "/prices", label: "价格", icon: Tags },
  { to: "/housing", label: "房价趋势", icon: Building2 },
  { to: "/cars", label: "汽车销量价格", icon: Car },
  { to: "/metals", label: "金属价格趋势", icon: Gem },
  { to: "/library", label: "知识库", icon: BookOpen },
  { to: "/files", label: "文件搜索", icon: Search },
  { to: "/stocks", label: "股票", icon: TrendingUp },
  { to: "/notes", label: "笔记", icon: FileText },
  { to: "/categories", label: "分类", icon: FolderTree },
  { to: "/agents", label: "Agent", icon: Bot },
  { to: "/archify", label: "Archify", icon: Network },
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
      {/* 侧栏跟着窗口缩：写死 14rem 的话，窗口一窄就先吃掉内容区的宽度，
          三栏页面（笔记 / 股票 / 知识库）会被挤到看不见东西 */}
      <aside className="flex w-[clamp(9rem,18%,14rem)] shrink-0 flex-col border-r bg-card">
        <div className="flex h-14 items-center px-4 border-b">
          <span className="truncate text-lg font-semibold tracking-tight">GoldEarth</span>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto space-y-1 p-2">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={label}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-muted-foreground">
          <span className="line-clamp-2">本地优先 · 离线可用</span>
        </div>
      </aside>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
