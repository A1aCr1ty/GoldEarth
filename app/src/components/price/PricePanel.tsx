/**
 * 价格追踪的主体：左边一列盯着的物品，右边选中那件的详情。
 *
 * 对照国内平台的公开在售样本，明确区分有效来源与未接入/受限来源。
 *
 * 拿不到数的时候界面必须说清楚是哪一环断了（被风控拦 / 要登录 /
 * 结构变了认不出价格），而不是留一个空卡片让人猜。
 */

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { open as openUrl } from "@tauri-apps/plugin-shell";
// echarts 6 里 EChartsOption 只在主入口导出，core 里叫 EChartsCoreOption
import type { EChartsOption } from "echarts";
import { RefreshCw, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tauri } from "@/lib/tauri";
import { UP, DOWN, FLAT, colorOf, fixed, signed } from "@/lib/format";
import { scalePx, useUiScaleValue } from "@/lib/uiScale";
import { errText } from "@/lib/errors";
import { usePrices } from "@/store/prices";
import type { PriceOverview, TrendPoint } from "@/types";

function money(value: number | null, currency = "CNY") {
  return `${currency === "CNY" ? "¥" : currency + " "}${fixed(value)}`;
}

function sourceName(source: string) {
  if (source?.startsWith("domestic:v1:")) {
    const names: Record<string, string> = { nine: "九机良品", xianyu: "闲鱼", jd: "京东二手", zhuanzhuan: "转转" };
    const platforms = source.slice("domestic:v1:".length).split("+").filter(Boolean);
    return `${platforms.length > 1 ? "国内多平台" : "单平台参考"} · ${platforms.map(id => names[id] || id).join(" / ")}`;
  }
  if (source?.startsWith("ebay:")) return "eBay 公开二手";
  return source === "xianyu" ? "闲鱼历史" : source === "manual" ? "手动记录" : "历史记录";
}

function openSource(url: string) {
  void openUrl(url).catch((e) => window.alert(`打开来源失败：${errText(e)}`));
}

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

/** 列表 + 详情 */
export function PricePanel() {
  const s = usePrices();

  if (s.items.length === 0) {
    return (
      <p className="py-10 text-center text-xs text-muted-foreground">
        加一件想关注的物品，再点「国内比价」，查询国内公开二手报价并核对平台与样本。
      </p>
    );
  }

  return (
    // lg 以下上下排，lg 以上左右分栏。两栏都用 minmax(0,…)，
    // 不然宽内容会把 grid 顶出横向滚动条
    <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {s.items.map((row) => (
          <Row
            key={row.target.id}
            row={row}
            active={s.selectedId === row.target.id}
            busy={s.probingFor === row.target.id}
            onSelect={() => void s.select(s.selectedId === row.target.id ? null : row.target.id)}
          />
        ))}
      </ul>

      <div className="min-w-0">
        {s.selectedId ? (
          <Detail targetId={s.selectedId} />
        ) : (
          <div className="flex h-full min-h-[12rem] items-center justify-center rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
            左边点一件东西，看它的均价走势。
          </div>
        )}
      </div>
    </div>
  );
}

/** 列表里的一行 */
function Row({
  row,
  active,
  busy,
  onSelect,
}: {
  row: PriceOverview;
  active: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  const remove = usePrices((s) => s.remove);
  const result = usePrices((s) => s.results[row.target.id]);
  const failed = result !== undefined && !result.ok;
  const [confirming, setConfirming] = useState(false);

  return (
    <li>
      <button
        className={
          "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors " +
          (active ? "bg-accent" : "hover:bg-accent/60")
        }
        onClick={onSelect}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="truncate text-sm font-medium">{row.target.name}</span>
            {!failed && row.changePct !== null && (
              <span className="shrink-0 text-xs tabular-nums" style={{ color: colorOf(row.changePct) }}>
                {signed(row.changePct, 1)}
              </span>
            )}
          </div>
          {failed && !busy && (
            <p className="mt-0.5 text-[0.6875rem] text-amber-600 dark:text-amber-400">
              本次未更新{result.needsVerification ? " · 待登录或验证" : " · 查询失败"}
            </p>
          )}
          <div className="flex flex-wrap items-baseline gap-2">
            {busy ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" /> 正在搜…
              </span>
            ) : row.latest === null ? (
              // 一次都还没抓到时不摆「--」：占位符看着像坏了，
              // 一句提示更能让人知道下一步该点哪儿
              <span className="text-xs text-muted-foreground">还没抓到价 · 点它去搜</span>
            ) : (
              <>
                <span className="text-[0.625rem] text-muted-foreground">上次记录</span>
                <span className={`text-lg font-semibold tabular-nums ${failed ? "text-muted-foreground" : ""}`}>{money(row.latest, row.currency)}</span>
                <Spark values={row.spark} />
                <span className="text-[0.625rem] text-muted-foreground">
                  {row.samples} 次 · {row.days} 天
                </span>
              </>
            )}
          </div>
          {row.latest !== null && (
            <p className="mt-0.5 text-[0.625rem] text-muted-foreground">{sourceName(row.source)} · {row.currency || "CNY"}</p>
          )}
        </div>

        {/* 删除要按两下：点一次变成「确定？」，避免手滑把盯了几个月的东西删掉 */}
        {confirming ? (
          <span className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant="destructive"
              className="h-6 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(false);
                void remove(row.target.id);
              }}
            >
              删除
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(false);
              }}
            >
              算了
            </Button>
          </span>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
            }}
            aria-label={`删除 ${row.target.name}`}
            title="不盯着它了"
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        )}
      </button>
    </li>
  );
}

/**
 * 迷你走势图。
 *
 * 故意用内联 SVG 而不是 echarts：列表里可能十几行，每行起一个 canvas
 * 纯属浪费，而这里只需要一条折线和一个趋势色。
 *
 * 只有一两个点时不画线——两点连成的线看着像暴跌，其实只是记了两次。
 */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 64;
  const h = 16;
  const min = Math.min(...values);
  const max = Math.max(...values);
  // 全平的线不能除以 0，给个固定高度，画出来正好在中间
  const span = max - min || 1;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(" ");
  const color = colorOf(values[values.length - 1] - values[0]);
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

/** 选中那件的详情：趋势图 + 抓价 */
function Detail({ targetId }: { targetId: string }) {
  const trend = usePrices((s) => s.trend);
  const loading = usePrices((s) => s.trendLoading);
  const probeRun = usePrices((s) => s.runProbe);
  const probe = usePrices((s) => s.results[targetId]);
  const row = usePrices((s) => s.items.find((item) => item.target.id === targetId));
  const querying = usePrices((s) => s.probingFor === targetId);
  const refreshingAll = usePrices((s) => s.refreshingAll);
  const probing = usePrices((s) => s.probing);
  const currency = row?.currency || "CNY";
  const sourceUrl = probe?.sourceUrl || `https://m2.9ji.com/search?keyword=${encodeURIComponent(row?.target.keyword || row?.target.name || "")}&searchType=3`;
  const [shareUrl, setShareUrl] = useState("");
  const [savingSource, setSavingSource] = useState(false);
  const [sourceError, setSourceError] = useState("");
  useEffect(() => {
    setShareUrl(row?.target.zhuanzhuanUrl || "");
    setSourceError("");
  }, [targetId, row?.target.zhuanzhuanUrl]);
  async function saveSource() {
    setSavingSource(true);
    setSourceError("");
    try {
      await tauri.setPriceZhuanzhuanUrl(targetId, shareUrl.trim());
      await usePrices.getState().refresh();
      await probeRun(targetId);
    } catch (e) { setSourceError(errText(e)); }
    finally { setSavingSource(false); }
  }

  async function handleProbe() {
    try {
      await probeRun(targetId);
    } catch (e) {
      window.alert(`查价失败：${errText(e)}`);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      {/* 没数据时不占地方：空画布 192px 高、里面就一行字，很难看也没地方放东西 */}
      {loading ? (
        <div className="flex h-56 items-center justify-center text-xs text-muted-foreground">正在算趋势…</div>
      ) : trend.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          还没有价格记录。点击「国内比价」，查看各平台实际可取得的人民币在售报价。
        </p>
      ) : (
        <div>
          <p className="mb-2 text-[0.6875rem] text-muted-foreground">
            {sourceName(row?.source || "")} · {currency} · 历史参考价
            {row?.updatedAt && ` · 上次记录于 ${new Date(row.updatedAt).toLocaleString("zh-CN")}`}
          </p>
          <div className="flex h-56 flex-col">
            <TrendChart points={trend} currency={currency} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-8 gap-1" onClick={() => void handleProbe()} disabled={probing || refreshingAll}>
          <Search className={querying ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {querying ? "正在对照各平台…" : "国内比价"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 shrink-0 text-xs"
          onClick={() => openSource(sourceUrl)}
          title="打开公开报价的搜索来源页"
        >
          查看报价来源
        </Button>
        <span className="text-[0.6875rem] text-muted-foreground">
          只采国内在售整机；配置与成色见样本，来源缺失会明确提示
        </span>
      </div>

      <div className="space-y-2 rounded border p-2">
        <label htmlFor={`zz-source-${targetId}`} className="text-xs font-medium">转转商品分享链接</label>
        <div className="flex flex-wrap gap-2">
          <Input id={`zz-source-${targetId}`} className="h-8 min-w-0 flex-1 text-xs" value={shareUrl}
            onChange={e => setShareUrl(e.target.value)} placeholder="粘贴含 infoId 的转转商品详情链接" disabled={savingSource || probing || refreshingAll} />
          <Button size="sm" variant="outline" className="h-8" onClick={() => void saveSource()}
            disabled={savingSource || probing || refreshingAll}>{savingSource ? "正在更新…" : "保存并查价"}</Button>
        </div>
        <p className="text-[0.6875rem] text-muted-foreground">保存一次后随查价更新，无需登录。逐页核对同款商品；不足 3 条仅展示，不纳入综合价。清空并保存可解除绑定。</p>
        {sourceError && <p className="text-xs text-destructive">{sourceError}</p>}
      </div>

      {probe && !querying && (
        <div
          className={
            probe.ok
              ? "rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs"
              : "rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
          }
        >
          <div className="flex items-start gap-1.5">
            {probe.ok ? null : <X className="mt-0.5 h-3 w-3 shrink-0" />}
            <div className="min-w-0 flex-1">
              {/* whitespace-pre-line：抓价失败时 Rust 会把页面看到的现场
                  （请求 URL、标题、正文片段）换行带回来，压成一行根本读不了 */}
              <p className={`whitespace-pre-line break-words ${probe.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                {probe.message}
              </p>
              {probe.query && <p className="mt-1 text-muted-foreground">检索词：{probe.query}</p>}
              {probe.ok && (
                <p className="mt-1 text-muted-foreground">
                  参考价 <b className="tabular-nums">{money(probe.avg, probe.currency)}</b>，样本区间 {money(probe.min, probe.currency)} ~ {money(probe.max, probe.currency)}
                  ，来源 {probe.source || "公开报价"}，共 {probe.count} 条
                </p>
              )}
              {probe.method && <p className="mt-1 text-muted-foreground">计算方式：{probe.method}；来源组合变化时单独记录趋势。</p>}
              {!!probe.sources?.length && (
                <div className="mt-3 space-y-2">
                  <p className="font-medium">平台覆盖：{probe.coverage || 0} / {probe.sources.length} 个来源取得足够样本</p>
                  {probe.sources.map(source => (
                    <div key={source.id} className="rounded border border-border/70 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button className="font-medium underline" onClick={() => openSource(source.url)}>{source.name}</button>
                        <span>{source.status === "ok" ? `${source.count} 条 · 中位数 ¥${fixed(source.median)}` : "未参与计算"}</span>
                      </div>
                      <p className="mt-1 text-[0.6875rem] text-muted-foreground">{source.message}</p>
                    </div>
                  ))}
                </div>
              )}
              {!!probe.listings?.length && (
                <details className="mt-2 text-muted-foreground">
                  <summary className="cursor-pointer">查看本次 {probe.listings.length} 条商品样本</summary>
                  <ul className="mt-2 space-y-2">
                    {probe.listings.map((item) => (
                      <li key={item.url} className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <button className="text-left underline hover:text-foreground" onClick={() => openSource(item.url)}>{item.title}</button>
                          <p className="mt-0.5 text-[0.6875rem]">{probe.sources?.find(s => s.id === item.source)?.name || item.source || probe.source}{item.condition && ` · ${item.condition}`}</p>
                        </div>
                        <span className="shrink-0 tabular-nums">{money(item.price, item.currency)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {probe.ret && (
                <details className="mt-2 text-[0.625rem] text-muted-foreground">
                  <summary className="cursor-pointer">查看响应详情</summary>
                  <p className="mt-1 break-all font-mono">{probe.ret}</p>
                </details>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 均价折线 + 每天的最低/最高带 */
function TrendChart({ points, currency }: { points: TrendPoint[]; currency: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const scale = useUiScaleValue();

  useEffect(() => {
    if (!ref.current) return;
    chart.current = echarts.init(ref.current, undefined, { renderer: "canvas" });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chart.current) return;
    if (points.length === 0) {
      chart.current.clear();
      return;
    }
    chart.current.setOption(build(points, scale, currency), true);
  }, [points, scale, currency]);

  return <div ref={ref} className="min-h-0 flex-1" />;
}

function build(points: TrendPoint[], scale: number, currency: string): EChartsOption {
  const s = (px: number) => scalePx(px, scale);
  const days = points.map((p) => p.day.slice(5));
  const avg = points.map((p) => p.avg);
  const low = points.map((p) => p.min);
  const high = points.map((p) => p.max);
  // 整体是涨是跌，决定这条线染成什么色：涨用红、跌用绿，
  // 和 A 股习惯一致（红涨绿跌），别跟欧美那套反过来
  const color = avg[0] <= avg[avg.length - 1] ? UP : DOWN;

  return {
    animation: false,
    grid: { left: s(currency === "CNY" ? 52 : 80), right: s(16), top: s(12), bottom: s(22) },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(22,26,35,0.94)",
      borderColor: "#3b4152",
      textStyle: { color: "#e6e9f0", fontSize: s(11) },
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number }[];
        const p = points[arr?.[0]?.dataIndex ?? -1];
        if (!p) return "";
        return [
          `<div style="font-weight:600">${p.day}</div>`,
          `参考价 ${money(p.avg, currency)}`,
          `区间 ${money(p.min, currency)} ~ ${money(p.max, currency)}`,
          `记了 ${p.count} 次`,
        ].join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      data: days,
      axisLine: { lineStyle: { color: "#3b4152" } },
      axisTick: { show: false },
      axisLabel: { color: "#8b93a7", fontSize: s(10) },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "#262b38" } },
      axisLabel: { color: "#8b93a7", fontSize: s(10), formatter: (v: number) => `${currency === "CNY" ? "¥" : currency + " "}${v}` },
    },
    series: [
      {
        // 最低价 + 最高价叠出一条「当天价差带」：带子越宽说明那天
        // 同款报价越分散，均价越不能当准数
        name: "最低",
        type: "line",
        data: low,
        showSymbol: false,
        lineStyle: { width: 1, type: "dashed", color: FLAT },
        stack: "band",
      },
      {
        name: "价差",
        type: "line",
        data: points.map((p) => Math.round((p.max - p.min) * 100) / 100),
        showSymbol: false,
        lineStyle: { opacity: 0 },
        stack: "band",
        areaStyle: { color: "rgba(139,147,167,0.16)" },
      },
      {
        name: "均价",
        type: "line",
        data: avg,
        showSymbol: points.length <= 30,
        symbolSize: s(4),
        smooth: false,
        lineStyle: { width: 1.8, color },
        itemStyle: { color },
      },
    ],
  } as EChartsOption;
}
