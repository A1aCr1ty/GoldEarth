import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PricePanel } from "@/components/price/PricePanel";
import { errText } from "@/lib/errors";
import { usePrices } from "@/store/prices";

/**
 * 价格追踪页。
 *
 * 单独一页而不是塞进首页：首页是天气/日历/推送，一天看一次；
 * 这个是「过几天回来看一眼跌到多少没有」，节奏完全不同，混在一起反而互相挤。
 *
 * 价格只有一个来路：App 自己的 WebView2 去闲鱼搜均价。
 * 手动录入已经去掉——「每隔几天手填一次」听着就不可能坚持。
 */
export default function PricePage() {
  const s = usePrices();
  const [name, setName] = useState("");
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    void s.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd() {
    if (name.trim().length === 0) return;
    const input = { name: name.trim(), keyword: keyword.trim() };
    setName("");
    setKeyword("");
    try {
      await s.add(input);
    } catch (e) {
      window.alert(`添加失败：${errText(e)}`);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部 min-h + 换行：窄窗口时按钮换到第二行，而不是被裁掉半个 */}
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">价格追踪</h1>
          <p className="text-[0.6875rem] text-muted-foreground">
            盯几件想买的东西，闲鱼的当天在售均价自动记下来，走势自己长出来
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {s.progress && (
            <span className="text-[0.6875rem] text-muted-foreground">
              {s.progress.done}/{s.progress.total}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => void s.refreshAll()}
            disabled={s.refreshingAll || s.probing}
            title="挨个去闲鱼搜一遍，逐件记均价"
          >
            <RefreshCw className={s.refreshingAll ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            全部查一遍
          </Button>
        </div>
      </header>

      {/* 加物品。关键词留空就直接拿名字去搜 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5">
        <Input
          className="h-8 min-w-[10rem] flex-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
          }}
          placeholder="想盯着什么？比如 MacBook Air M5"
        />
        <Input
          className="h-8 w-full sm:w-44"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
          }}
          placeholder="搜索词（留空＝用名字）"
        />
        <Button
          size="sm"
          className="h-8 gap-1"
          onClick={() => void handleAdd()}
          disabled={name.trim().length === 0}
        >
          <Plus className="h-3.5 w-3.5" /> 加进来
        </Button>
      </div>

      {s.error && (
        <div className="shrink-0 border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {s.error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {s.loading && s.items.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">加载中…</p>
        ) : (
          <PricePanel />
        )}
      </div>
    </div>
  );
}
