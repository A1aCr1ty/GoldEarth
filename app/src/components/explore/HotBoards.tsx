import { useState } from "react";
import {
  AlertCircle,
  Check,
  Clock,
  Cookie,
  Flame,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { errText } from "@/lib/errors";
import { tauri } from "@/lib/tauri";
import type { HotBoard, HotItem, HotSourceInfo } from "@/types";

/**
 * 点条目怎么打开。
 *
 * 默认在 App 内的阅读器窗口里打开——这几个平台的页面大多禁止被 iframe 嵌套，
 * 所以走后端新开一个 WebView 窗口（见 `commands/reader.rs`），
 * 用户不用切到浏览器，App 窗口也不会被顶掉。
 *
 * **Ctrl / ⌘ + 点击和中键仍然走系统浏览器**：站内页面偶尔有兼容问题
 * （登录态、地区风控），留一个能立刻绕开的出口，不至于只能干等。
 */
async function openItem(item: HotItem, e: React.MouseEvent) {
  e.preventDefault();
  const wantsBrowser = e.ctrlKey || e.metaKey || e.button === 1;
  if (wantsBrowser) {
    openExternal(item.url);
    return;
  }
  try {
    await tauri.openReader(item.url, item.title);
  } catch (err) {
    // 窗口起不来（权限、平台限制等）时退回系统浏览器，别让用户点了没反应
    openExternal(item.url);
    console.warn("阅读器打开失败，已退回系统浏览器：", errText(err));
  }
}

/** 打开系统浏览器 */
function openExternal(url: string) {
  void openUrl(url).catch(() => window.open(url, "_blank", "noopener"));
}

/** 卡片顶部的平台条 */
function BoardHeader({
  board,
  loading,
  onRefresh,
}: {
  board: HotBoard;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: board.accent }}
        aria-hidden
      />
      <span className="truncate text-sm font-semibold">{board.label}</span>
      {board.cached && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.625rem] text-muted-foreground">
          缓存
        </span>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto h-6 w-6 shrink-0 p-0"
        onClick={onRefresh}
        disabled={loading}
        title="刷新这一栏"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
      </Button>
    </div>
  );
}

/** 「这个平台要 Cookie」的空态，顺带告诉用户怎么取 */
function NeedCookie({ board, source }: { board: HotBoard; source?: HotSourceInfo }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <Cookie className="h-7 w-7 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{board.label}需要登录 Cookie</p>
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          {board.error ?? "该平台不放行匿名请求，需要带上你自己的登录态。"}
        </p>
        <p className="max-w-xs text-[0.6875rem] leading-relaxed text-muted-foreground">
          在浏览器登录{board.label} → 开发者工具 Network → 任一请求 → 复制 Cookie 请求头，粘到下面。
        </p>
      </div>
      {open ? (
        <div className="w-full max-w-sm space-y-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="粘贴 Cookie 整串"
            className="h-8 text-xs"
            type="password"
            autoFocus
          />
          <div className="flex items-center justify-center gap-1.5">
            <Button
              size="sm"
              className="h-7"
              disabled={saving || value.trim().length === 0}
              onClick={async () => {
                setSaving(true);
                try {
                  await saveSourceCookie(source?.value, value.trim());
                  setOpen(false);
                  setValue("");
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Check className="h-3 w-3" /> 保存并刷新
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setOpen(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="h-7" onClick={() => setOpen(true)}>
          <Settings2 className="h-3 w-3" /> 配置 Cookie
        </Button>
      )}
    </div>
  );
}

/** 把保存动作转发到 store。动态 import 免得组件顶层就把 store 拉进来 */
async function saveSourceCookie(source: string | undefined, cookie: string) {
  if (!source) return;
  const { useTrending } = await import("@/store/trending");
  await useTrending.getState().saveCookie(source, cookie);
}

/** 一条热榜 */
function Row({ item, accent }: { item: HotItem; accent: string }) {
  const [imgOk, setImgOk] = useState(true);
  const showCover = Boolean(item.cover) && imgOk;

  return (
    <a
      href={item.url}
      onClick={(e) => void openItem(item, e)}
      // 中键走的是 auxclick，click 里拿不到 button === 1
      onAuxClick={(e) => {
        if (e.button === 1) void openItem(item, e);
      }}
      title="在应用内打开（按住 Ctrl / ⌘ 点或中键可跳系统浏览器）"
      className="flex gap-2.5 border-b px-3 py-2 transition-colors last:border-b-0 hover:bg-accent/60"
    >
      {/* 榜单才显示序号；快讯 / 新闻是时间流，rank 为 0，画个「0」反而误导 */}
      {item.rank > 0 && (
        <span
          className={cn(
            "mt-0.5 w-4 shrink-0 text-center font-mono text-xs tabular-nums",
            item.rank <= 3 ? "font-bold" : "text-muted-foreground"
          )}
          style={item.rank <= 3 ? { color: accent } : undefined}
        >
          {item.rank}
        </span>
      )}

      {showCover && (
        <img
          src={item.cover}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgOk(false)}
          className="h-11 w-[4.5rem] shrink-0 rounded object-cover"
        />
      )}

      <div className="min-w-0 flex-1">
        {/* 标题和摘要都按行数截断（热榜一屏要放下几十条，不能无限撑高），
            完整文案放到 title 上，鼠标停住能看全 */}
        <p className="line-clamp-2 text-[0.8125rem] leading-snug" title={item.title}>
          {item.title}
        </p>
        {item.summary && (
          <p className="mt-0.5 line-clamp-1 text-[0.6875rem] text-muted-foreground" title={item.summary}>
            {item.summary}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.6875rem] text-muted-foreground">
          {item.tag && (
            <span
              className="rounded px-1 py-px text-[0.625rem]"
              style={{ backgroundColor: `${accent}1f`, color: accent }}
            >
              {item.tag}
            </span>
          )}
          {item.author && <span className="max-w-full truncate">{item.author}</span>}
          {item.hotText && <span className="tabular-nums">{item.hotText}</span>}
          {item.meta && <span>{item.meta}</span>}
        </div>
      </div>
    </a>
  );
}

/**
 * 一张平台榜单卡。
 *
 * 「丝滑」的关键：**刷新时不卸载旧条目**，只让内容区降一点透明度，
 * 新数据到位后原地替换。所以滚动位置不会跳，视觉上不会白屏。
 */
export function HotBoardCard({
  board,
  loading,
  source,
  onRefresh,
}: {
  board: HotBoard;
  loading: boolean;
  source?: HotSourceInfo;
  onRefresh: () => void;
}) {
  const empty = board.items.length === 0;

  return (
    <section className="flex min-h-[16rem] flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
      <BoardHeader board={board} loading={loading} onRefresh={onRefresh} />

      {/* 抓取失败但有旧数据兜底时，顶部挂一条提示，不遮内容 */}
      {board.error && !empty && (
        <div className="flex items-start gap-1.5 border-b bg-amber-500/10 px-3 py-1.5 text-[0.6875rem] text-amber-600 dark:text-amber-400">
          <AlertCircle className="mt-px h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1">{board.error}</span>
        </div>
      )}

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col transition-opacity duration-200",
          loading && !empty && "opacity-60"
        )}
      >
        {empty && board.error && board.needsCookie ? (
          <NeedCookie board={board} source={source} />
        ) : empty && board.error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <AlertCircle className="h-6 w-6 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">{board.error}</p>
            <Button size="sm" variant="outline" className="h-7" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> 重试
            </Button>
          </div>
        ) : empty ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Flame className="h-6 w-6" />
              <p className="text-xs">{loading ? "正在拉取…" : "暂无内容"}</p>
            </div>
          </div>
        ) : (
          // 卡片不再自己滚动：条目有多少就铺多高，整页只有一个滚动条。
          // 以前这里套了个内层滚动区，50 条的榜单被关在一屏里，
          // 看不见还多一根滚动条，两头都不讨好。
          <div className="min-h-0 flex-1">
            {board.items.map((item) => (
              <Row key={`${board.source}-${item.rank}-${item.url}`} item={item} accent={board.accent} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * 卡片底部的条数与更新时间。
 *
 * 时间显示到**秒**：只显示到分钟的话，同一分钟里点好几次刷新，
 * 看上去和没刷一样（内容本来也不会在几秒内变），用户会以为刷新坏了。
 */
export function BoardFooter({ board }: { board: HotBoard }) {
  if (board.items.length === 0) return null;
  return (
    <div className="flex items-center justify-end gap-1 px-3 pb-2 text-[0.6875rem] text-muted-foreground">
      <span>{board.items.length} 条</span>
      {board.updatedAt && <span>·</span>}
      <span className="flex items-center gap-1" title="这次数据抓取于">
        <Clock className="h-3 w-3" />
        {new Date(board.updatedAt).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </span>
    </div>
  );
}
