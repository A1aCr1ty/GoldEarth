import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NAV_TREE, SIDEBAR_COLLAPSED_KEY, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_KEYBOARD_STEP,
  SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_OPEN_KEY, SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDTH_KEY,
  SidebarIconName, SidebarLeaf, SidebarNode, clampSidebarWidth,
  containsRoute, isGroup, readOpenGroups, readSidebarCollapsed, readSidebarWidth, resolveOpen,
  writeJson,
} from "@/lib/sidebar";
import {
  Bot, BookOpen, Building2, Car, Compass, FileText, FolderTree, Gem, LayoutDashboard,
  Network, Search, Settings as SettingsIcon, Tags, TrendingUp,
} from "lucide-react";

const ICONS: Record<SidebarIconName, typeof Compass> = {
  dashboard: LayoutDashboard,
  compass: Compass,
  tags: Tags,
  building: Building2,
  car: Car,
  gem: Gem,
  trending: TrendingUp,
  book: BookOpen,
  search: Search,
  note: FileText,
  folder: FolderTree,
  network: Network,
  bot: Bot,
  settings: SettingsIcon,
};

/** 图标栏里的悬浮提示：折叠后没有文字，hover 才能知道是哪一页 */
function Tip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100">
      {label}
    </span>
  );
}

export function Sidebar() {
  // 侧栏宽度、折叠状态、展开的目录都落在 localStorage：窗口大小会变，
  // 但用户调好的宽度不该每次启动都重置
  const [width, setWidth] = useState(() => readSidebarWidth(window.localStorage));
  const [collapsed, setCollapsed] = useState(() => readSidebarCollapsed(window.localStorage));
  const [openGroups, setOpenGroups] = useState<string[]>(() => readOpenGroups(window.localStorage));
  const [pathname, setPathname] = useState(() => window.location.hash.slice(1) || "/home");
  const asideRef = useRef<HTMLElement | null>(null);

  // 路由变了就同步高亮：侧栏读 hash，避免再引入一层路由状态
  useEffect(() => {
    const sync = () => setPathname(window.location.hash.slice(1) || "/home");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const toggleGroup = useCallback((id: string) => {
    setOpenGroups((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      writeJson(window.localStorage, SIDEBAR_OPEN_KEY, next);
      return next;
    });
  }, []);

  /** 展开态 = 手动展开 ∪ 当前路由的祖先链，保证深层链接点进来能看见自己 */
  const openSet = useMemo(
    () => resolveOpen(NAV_TREE, pathname, openGroups),
    [pathname, openGroups]
  );

  const effectiveWidth = collapsed ? SIDEBAR_RAIL_WIDTH : width;

  /* 拖动右边框改宽度：跟着指针走，按帧节流，写入前先夹到合法区间。
     指针松开、取消或者移出窗口都要收尾，否则光标会一直卡在 resizing 状态。 */
  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    let frame = 0;
    let latestX = startX;
    const apply = () => {
      frame = 0;
      const next = clampSidebarWidth(startWidth + (latestX - startX));
      setWidth(next);
    };
    const onMove = (e: PointerEvent) => {
      latestX = e.clientX;
      if (frame === 0) frame = window.requestAnimationFrame(apply);
    };
    const finish = () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      setWidth((current) => {
        writeJson(window.localStorage, SIDEBAR_WIDTH_KEY, current);
        return current;
      });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      target.releasePointerCapture?.(event.pointerId);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, [width]);

  /** 双击边框回到默认宽度 */
  const onHandleDoubleClick = useCallback(() => {
    setWidth(SIDEBAR_DEFAULT_WIDTH);
    writeJson(window.localStorage, SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT_WIDTH);
  }, []);

  /** 键盘也能调宽度：聚焦边框后用左右方向键 */
  const onHandleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -SIDEBAR_KEYBOARD_STEP : SIDEBAR_KEYBOARD_STEP;
    setWidth((prev) => {
      const next = clampSidebarWidth(prev + delta);
      writeJson(window.localStorage, SIDEBAR_WIDTH_KEY, next);
      return next;
    });
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeJson(window.localStorage, SIDEBAR_COLLAPSED_KEY, next);
      return next;
    });
  }, []);

  const renderLeaf = (leaf: SidebarLeaf, depth: number) => {
    const Icon = leaf.icon ? ICONS[leaf.icon] : null;
    if (collapsed) {
      return (
        <NavLink
          key={leaf.to}
          to={leaf.to}
          title={leaf.hint ?? leaf.label}
          className={({ isActive }) =>
            cn(
              "group relative flex h-9 w-full items-center justify-center rounded-md transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )
          }
        >
          {Icon ? <Icon className="h-4 w-4" /> : <span className="h-4 w-4" />}
          <Tip label={leaf.hint ?? leaf.label} />
        </NavLink>
      );
    }
    return (
      <NavLink
        key={leaf.to}
        to={leaf.to}
        title={leaf.hint ?? leaf.label}
        // 层级用缩进表示：目录可以继续往下嵌套，缩进就跟着 depth 走
        style={{ paddingLeft: `${0.75 + depth * 0.75}rem` }}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-2 rounded-md py-2 pr-3 text-sm transition-colors",
            isActive
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )
        }
      >
        {Icon ? <Icon className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0" />}
        <span className="truncate">{leaf.label}</span>
      </NavLink>
    );
  };

  const renderNode = (node: SidebarNode, depth: number): React.ReactElement => {
    if (!isGroup(node)) return renderLeaf(node, depth);
    const open = collapsed ? true : openSet.has(node.id);
    const active = containsRoute(node, pathname);

    if (collapsed) {
      // 图标栏放不下多级目录：折叠时把整棵子树摊平成一列图标
      return (
        <div key={node.id} className="space-y-0.5">
          {node.children.map((child) => renderNode(child, 0))}
        </div>
      );
    }

    return (
      <div key={node.id}>
        <button
          type="button"
          onClick={() => toggleGroup(node.id)}
          aria-expanded={open}
          title={node.label}
          style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
          className={cn(
            "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-sm transition-colors",
            active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />
          <span className="truncate">{node.label}</span>
          {/* 当前路由在这棵子树里时给个竖条，滚到很长的目录里也能一眼找到 */}
          {active && !open && <span className="ml-auto h-4 w-0.5 rounded-full bg-primary" />}
        </button>
        {open && <div className="mt-0.5 space-y-0.5">{node.children.map((child) => renderNode(child, depth + 1))}</div>}
      </div>
    );
  };

  return (
    <aside
      ref={asideRef}
      style={{ width: effectiveWidth }}
      className="relative flex shrink-0 flex-col border-r bg-card transition-[width] duration-150"
    >
      <div className={cn("flex h-14 shrink-0 items-center border-b", collapsed ? "justify-center px-0" : "gap-1 px-3")}>
        {!collapsed && <span className="flex-1 truncate text-lg font-semibold tracking-tight">GoldEarth</span>}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "展开侧栏" : "收起侧栏"}
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {NAV_TREE.map((group) => renderNode(group, 0))}
      </nav>
      {!collapsed && (
        <div className="border-t p-3 text-xs text-muted-foreground">
          <span className="line-clamp-2">本地优先 · 离线可用</span>
        </div>
      )}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧栏宽度"
          aria-valuenow={width}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          tabIndex={0}
          onPointerDown={startResize}
          onDoubleClick={onHandleDoubleClick}
          onKeyDown={onHandleKeyDown}
          title="拖动调整宽度，双击恢复默认"
          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40 focus-visible:bg-primary/40 focus-visible:outline-none"
        />
      )}
    </aside>
  );
}
