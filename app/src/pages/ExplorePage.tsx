import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AUTO_REFRESH_MS, useTrending } from "@/store/trending";
import { BoardFooter, HotBoardCard } from "@/components/explore/HotBoards";

export default function ExplorePage() {
  const s = useTrending();

  useEffect(() => {
    void s.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自动刷新：窗口切到后台时停掉，省得看不见的时候还在打接口。
  // 回来时立刻补一次，不用干等下一轮。
  useEffect(() => {
    if (!s.autoRefresh) return;
    let timer: number | undefined;

    const start = () => {
      stop();
      timer = window.setInterval(() => {
        if (document.visibilityState === "visible") void useTrending.getState().refresh();
      }, AUTO_REFRESH_MS);
    };
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void useTrending.getState().refresh();
    };

    start();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [s.autoRefresh]);

  const anyLoading = s.active.some((k) => s.loading[k]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">网上冲浪</h1>
          <p className="text-[0.6875rem] text-muted-foreground">
            聚合热榜 · 点条目跳原文
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* B 站口径切换 */}
          {s.kinds.length > 0 && (
            <>
              <div className="mr-1 flex overflow-hidden rounded-md border">
                {s.kinds.map((k) => (
                  <button
                    key={k.value}
                    onClick={() => s.setKind(k.value)}
                    className={cn(
                      "px-2 py-1 text-xs transition-colors",
                      s.kind === k.value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <span className="mx-1 h-4 w-px shrink-0 bg-border" />
            </>
          )}

          <Button
            size="sm"
            variant={s.autoRefresh ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => s.setAutoRefresh(!s.autoRefresh)}
            title={s.autoRefresh ? "关掉每 3 分钟自动刷新" : "打开每 3 分钟自动刷新"}
          >
            {s.autoRefresh ? "自动刷新 开" : "自动刷新 关"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void s.refresh()} disabled={anyLoading}>
            <RefreshCw className={cn("h-3.5 w-3.5", anyLoading && "animate-spin")} /> 全部刷新
          </Button>
        </div>
      </header>

      {/* 平台筛选：点一下增减对应卡片 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-4 py-1.5">
        {s.sources.map((src) => {
          const on = s.active.includes(src.value);
          return (
            <button
              key={src.value}
              onClick={() => s.toggleSource(src.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                on
                  ? "border-transparent bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60"
              )}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: on ? src.accent : "currentColor", opacity: on ? 1 : 0.5 }}
                aria-hidden
              />
              {src.label}
              {src.needsCookie && (
                <span className="text-[0.625rem] opacity-70">{src.cookieReady ? "· 已配置" : "· 需 Cookie"}</span>
              )}
            </button>
          );
        })}
        <span className="ml-auto text-[0.6875rem] text-muted-foreground">
          {anyLoading ? "同步中…" : s.lastSync ? `更新于 ${new Date(s.lastSync).toLocaleTimeString("zh-CN")}` : ""}
        </span>
      </div>

      {s.error && (
        <div className="shrink-0 border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {s.error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {s.active.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <p className="text-sm">上面一个平台都没选</p>
            <p className="text-xs">点上面的标签把平台加回来</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-4">
            {s.active.map((key) => {
              const board = s.boards[key];
              const source = s.sources.find((x) => x.value === key);
              if (!board) {
                // 首屏还没回来：给个等高度的骨架，避免卡片一个个弹出来
                return (
                  <div
                    key={key}
                    className="flex h-[16rem] items-center justify-center rounded-lg border bg-card text-xs text-muted-foreground"
                  >
                    加载中…
                  </div>
                );
              }
              return (
                <div key={key} className="flex min-h-[16rem] flex-col">
                  <div className="flex min-h-0 flex-1 flex-col">
                    <HotBoardCard
                      board={board}
                      loading={Boolean(s.loading[key])}
                      source={source}
                      onRefresh={() => void s.refresh(key)}
                    />
                  </div>
                  <BoardFooter board={board} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
