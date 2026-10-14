/**
 * K 线图：主图（蜡烛 + 均线 + BOLL）+ 成交量 + 技术指标副图。
 *
 * 用 `echarts/core` 按需引入，避免把整个 ECharts 打进包里。
 * 指标序列由 `lib/indicators` 计算后喂进来——不交给 ECharts 自己算，
 * 是为了让图上的线和右侧「指标读数」面板永远是同一组数字。
 */

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { CandlestickChart, BarChart, LineChart } from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import { computeAll, toPairs } from "@/lib/indicators";
import { scalePx, useUiScaleValue } from "@/lib/uiScale";
import { DOWN, UP, fixed, volumeText } from "@/lib/format";
import type { Candle } from "@/types";

echarts.use([
  CandlestickChart,
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DataZoomComponent,
  LegendComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

/** 副图指标 */
export type SubIndicator = "macd" | "kdj" | "rsi";

const SUB_TITLE: Record<SubIndicator, string> = { macd: "MACD(12,26,9)", kdj: "KDJ(9,3,3)", rsi: "RSI(6,12,24)" };

const MA_COLORS = ["#e8b339", "#4a9eff", "#c05be0", "#37c2d0"];

interface Props {
  candles: Candle[];
  sub: SubIndicator;
  showBoll: boolean;
}

export function KlineChart({ candles, sub, showBoll }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  // 图表里的字号和边距是 px，得跟着全局缩放自己换算
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
    if (!chart.current || candles.length === 0) {
      chart.current?.clear();
      return;
    }
    chart.current.setOption(buildOption(candles, sub, showBoll, scale), true);
  }, [candles, sub, showBoll, scale]);

  return <div ref={ref} className="h-full w-full" />;
}

function buildOption(
  candles: Candle[],
  sub: SubIndicator,
  showBoll: boolean,
  scale: number
): EChartsOption {
  const s = (px: number) => scalePx(px, scale);
  const dates = candles.map((c) => c.date);
  // ECharts 蜡烛图的数据顺序是 [开, 收, 低, 高]
  const ohlc = candles.map((c) => [c.open, c.close, c.low, c.high]);
  const tech = computeAll(candles);
  const volumes = candles.map((c, i) => ({
    value: c.volume,
    itemStyle: { color: c.close >= c.open ? UP : DOWN },
  }));

  const series: Record<string, unknown>[] = [];
  // 主图
  series.push(
    {
      name: "K线",
      type: "candlestick",
      data: ohlc,
      itemStyle: {
        // 红涨绿跌
        color: UP,
        color0: DOWN,
        borderColor: UP,
        borderColor0: DOWN,
      },
      xAxisIndex: 0,
      yAxisIndex: 0,
    },
    { name: "MA5", type: "line", data: toPairs(dates, tech.ma5), smooth: true, showSymbol: false, lineStyle: { width: 1, color: MA_COLORS[0] }, xAxisIndex: 0, yAxisIndex: 0 },
    { name: "MA10", type: "line", data: toPairs(dates, tech.ma10), smooth: true, showSymbol: false, lineStyle: { width: 1, color: MA_COLORS[1] }, xAxisIndex: 0, yAxisIndex: 0 },
    { name: "MA20", type: "line", data: toPairs(dates, tech.ma20), smooth: true, showSymbol: false, lineStyle: { width: 1, color: MA_COLORS[2] }, xAxisIndex: 0, yAxisIndex: 0 },
    { name: "MA60", type: "line", data: toPairs(dates, tech.ma60), smooth: true, showSymbol: false, lineStyle: { width: 1, color: MA_COLORS[3] }, xAxisIndex: 0, yAxisIndex: 0 }
  );
  if (showBoll) {
    series.push(
      { name: "BOLL上轨", type: "line", data: toPairs(dates, tech.boll.upper), showSymbol: false, lineStyle: { width: 1, color: "#e0715f" }, xAxisIndex: 0, yAxisIndex: 0 },
      { name: "BOLL下轨", type: "line", data: toPairs(dates, tech.boll.lower), showSymbol: false, lineStyle: { width: 1, color: "#3fae8f" }, xAxisIndex: 0, yAxisIndex: 0 }
    );
  }

  // 成交量
  series.push({
    name: "成交量",
    type: "bar",
    data: volumes,
    xAxisIndex: 1,
    yAxisIndex: 1,
  });

  // 副图
  if (sub === "macd") {
    series.push(
      { name: "MACD柱", type: "bar", data: tech.macd.hist, xAxisIndex: 2, yAxisIndex: 2, itemStyle: { color: (p: { data: number }) => (p.data >= 0 ? UP : DOWN) } },
      { name: "DIF", type: "line", data: tech.macd.dif, showSymbol: false, lineStyle: { width: 1, color: "#e8b339" }, xAxisIndex: 2, yAxisIndex: 2 },
      { name: "DEA", type: "line", data: tech.macd.dea, showSymbol: false, lineStyle: { width: 1, color: "#4a9eff" }, xAxisIndex: 2, yAxisIndex: 2 }
    );
  } else if (sub === "kdj") {
    series.push(
      { name: "K", type: "line", data: tech.kdj.k, showSymbol: false, lineStyle: { width: 1, color: "#e8b339" }, xAxisIndex: 2, yAxisIndex: 2 },
      { name: "D", type: "line", data: tech.kdj.d, showSymbol: false, lineStyle: { width: 1, color: "#4a9eff" }, xAxisIndex: 2, yAxisIndex: 2 },
      { name: "J", type: "line", data: tech.kdj.j, showSymbol: false, lineStyle: { width: 1, color: "#c05be0" }, xAxisIndex: 2, yAxisIndex: 2 }
    );
  } else {
    series.push(
      { name: "RSI6", type: "line", data: tech.rsi6, showSymbol: false, lineStyle: { width: 1, color: "#e8b339" }, xAxisIndex: 2, yAxisIndex: 2 },
      { name: "RSI12", type: "line", data: tech.rsi12, showSymbol: false, lineStyle: { width: 1, color: "#4a9eff" }, xAxisIndex: 2, yAxisIndex: 2 },
      { name: "RSI24", type: "line", data: tech.rsi24, showSymbol: false, lineStyle: { width: 1, color: "#c05be0" }, xAxisIndex: 2, yAxisIndex: 2 }
    );
  }

  const gridBase = { left: s(52), right: s(58), containLabel: false };
  return {
    animation: false,
    // K 线、成交量、副图共享一条十字光标
    axisPointer: { link: [{ xAxisIndex: "all" }], label: { backgroundColor: "#3b4152" } },
    legend: {
      top: s(2),
      left: s(60),
      itemWidth: s(14),
      itemHeight: s(2),
      textStyle: { color: "#8b93a7", fontSize: s(11) },
      data: showBoll ? ["MA5", "MA10", "MA20", "MA60", "BOLL上轨", "BOLL下轨"] : ["MA5", "MA10", "MA20", "MA60"],
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: "rgba(22,26,35,0.94)",
      borderColor: "#3b4152",
      textStyle: { color: "#e6e9f0", fontSize: s(12) },
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number }[];
        if (!arr?.length) return "";
        const i = arr[0].dataIndex;
        const c = candles[i];
        if (!c) return "";
        const rise = c.close >= c.open;
        const color = rise ? UP : DOWN;
        const lines = [
          `<div style="font-weight:600;margin-bottom:${s(2)}px">${c.date}</div>`,
          `开 <b style="color:${color}">${fixed(c.open)}</b>　高 <b style="color:${color}">${fixed(c.high)}</b>`,
          `收 <b style="color:${color}">${fixed(c.close)}</b>　低 <b style="color:${color}">${fixed(c.low)}</b>`,
          `涨跌 <b style="color:${color}">${c.change >= 0 ? "+" : ""}${fixed(c.change)}（${c.change >= 0 ? "+" : ""}${fixed(c.changePct)}%）</b>`,
          `振幅 ${fixed(c.amplitude)}%　换手 ${fixed(c.turnover)}%`,
          `成交量 ${volumeText(c.volume)}`,
        ];
        const t = computeAll(candles.slice(0, i + 1));
        const last = (a: (number | null)[]) => {
          for (let k = a.length - 1; k >= 0; k--) if (a[k] !== null) return a[k];
          return null;
        };
        lines.push(
          `MA5 ${fixed(last(t.ma5))}　MA10 ${fixed(last(t.ma10))}　MA20 ${fixed(last(t.ma20))}　MA60 ${fixed(last(t.ma60))}`
        );
        lines.push(`DIF ${fixed(last(t.macd.dif), 3)}　DEA ${fixed(last(t.macd.dea), 3)}`);
        lines.push(`K ${fixed(last(t.kdj.k))}　D ${fixed(last(t.kdj.d))}　J ${fixed(last(t.kdj.j))}`);
        lines.push(`RSI6 ${fixed(last(t.rsi6))}　RSI12 ${fixed(last(t.rsi12))}　RSI24 ${fixed(last(t.rsi24))}`);
        return lines.join("<br/>");
      },
    },
    grid: [
      { ...gridBase, top: s(24), height: "50%" },
      { ...gridBase, top: "62%", height: "12%" },
      { ...gridBase, top: "77%", height: "16%" },
    ],
    xAxis: [
      { type: "category", data: dates, gridIndex: 0, axisLine: { lineStyle: { color: "#3b4152" } }, axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false } },
      { type: "category", data: dates, gridIndex: 1, axisLine: { lineStyle: { color: "#3b4152" } }, axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false } },
      { type: "category", data: dates, gridIndex: 2, axisLine: { lineStyle: { color: "#3b4152" } }, axisLabel: { color: "#8b93a7", fontSize: s(10) }, axisTick: { show: false }, splitLine: { show: false } },
    ],
    yAxis: [
      { scale: true, gridIndex: 0, position: "right", axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#8b93a7", fontSize: s(10) }, splitLine: { lineStyle: { color: "#262b38" } } },
      { scale: true, gridIndex: 1, position: "right", axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { color: "#8b93a7", fontSize: s(10) }, name: "量", nameTextStyle: { color: "#8b93a7", fontSize: s(10) } },
      { scale: true, gridIndex: 2, position: "right", axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: "#262b38" } }, axisLabel: { color: "#8b93a7", fontSize: s(10) }, name: SUB_TITLE[sub], nameTextStyle: { color: "#8b93a7", fontSize: s(10), align: "right" } },
    ],
    dataZoom: [
      { type: "inside", xAxisIndex: [0, 1, 2], start: 60, end: 100 },
      {
        type: "slider",
        xAxisIndex: [0, 1, 2],
        bottom: s(4),
        height: s(16),
        start: 60,
        end: 100,
        borderColor: "#3b4152",
        backgroundColor: "transparent",
        fillerColor: "rgba(74,158,255,0.12)",
        handleStyle: { color: "#4a9eff" },
        textStyle: { color: "#8b93a7", fontSize: s(10) },
      },
    ],
    series,
  } as EChartsOption;
}