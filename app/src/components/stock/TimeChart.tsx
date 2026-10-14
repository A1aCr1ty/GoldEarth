/**
 * 当日分时图：价格线 + 均价线 + 分钟成交量。
 *
 * 纵轴按昨收为中心上下对称，这样涨跌幅在视觉上才是等价的（和主流行情软件一致）。
 */

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { AxisPointerComponent, DataZoomComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import { DOWN, UP, fixed, volumeText } from "@/lib/format";
import { scalePx, useUiScaleValue } from "@/lib/uiScale";
import type { Trend } from "@/types";

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, AxisPointerComponent, DataZoomComponent, CanvasRenderer]);

export function TimeChart({ trend }: { trend: Trend | null }) {
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
    if (!chart.current || !trend || trend.points.length === 0) {
      chart.current?.clear();
      return;
    }
    chart.current.setOption(build(trend, scale), true);
  }, [trend, scale]);

  return <div ref={ref} className="h-full w-full" />;
}

function build(trend: Trend, scale: number): EChartsOption {
  const s = (px: number) => scalePx(px, scale);
  const times = trend.points.map((p) => p.time);
  const prices = trend.points.map((p) => p.price);
  const avgs = trend.points.map((p) => p.avgPrice);
  const pre = trend.preClose || prices[0] || 1;

  // 上下对称：取实际波动幅度和昨收的一个固定比例兜底，避免股价不动时轴被压扁
  let span = 0;
  for (const p of prices) span = Math.max(span, Math.abs(p - pre));
  if (span === 0) span = pre * 0.02;
  const max = pre + span * 1.15;
  const min = pre - span * 1.15;

  const maxVol = Math.max(...trend.points.map((p) => p.volume), 1);
  const volumes = trend.points.map((p) => ({
    value: p.volume,
    itemStyle: { color: p.price >= pre ? UP : DOWN },
  }));

  return {
    animation: false,
    axisPointer: { link: [{ xAxisIndex: "all" }], label: { backgroundColor: "#3b4152" } },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: "rgba(22,26,35,0.94)",
      borderColor: "#3b4152",
      textStyle: { color: "#e6e9f0", fontSize: s(12) },
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number }[];
        if (!arr?.length) return "";
        const p = trend.points[arr[0].dataIndex];
        if (!p) return "";
        const pct = ((p.price - pre) / pre) * 100;
        const color = pct >= 0 ? UP : DOWN;
        return [
          `<div style="font-weight:600">${p.time}</div>`,
          `价格 <b style="color:${color}">${fixed(p.price)}</b>　<b style="color:${color}">${pct >= 0 ? "+" : ""}${fixed(pct)}%</b>`,
          `均价 ${fixed(p.avgPrice)}`,
          `分钟量 ${volumeText(p.volume)}`,
        ].join("<br/>");
      },
    },
    grid: [
      { left: s(56), right: s(64), top: s(16), height: "62%" },
      { left: s(56), right: s(64), top: "80%", height: "16%" },
    ],
    xAxis: [
      { type: "category", data: times, gridIndex: 0, boundaryGap: false, axisLine: { lineStyle: { color: "#3b4152" } }, axisLabel: { show: false }, axisTick: { show: false } },
      { type: "category", data: times, gridIndex: 1, boundaryGap: false, axisLine: { lineStyle: { color: "#3b4152" } }, axisLabel: { color: "#8b93a7", fontSize: s(10) }, axisTick: { show: false } },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        min,
        max,
        position: "right",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#262b38" } },
        axisLabel: {
          color: "#8b93a7",
          fontSize: s(10),
          formatter: (v: number) => v.toFixed(2),
        },
      },
      {
        type: "value",
        gridIndex: 0,
        min: ((min - pre) / pre) * 100,
        max: ((max - pre) / pre) * 100,
        position: "left",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: "#8b93a7", fontSize: s(10), formatter: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` },
      },
      {
        type: "value",
        gridIndex: 1,
        max: maxVol,
        position: "right",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: "#8b93a7", fontSize: s(9), formatter: (v: number) => (v >= 1e4 ? `${(v / 1e4).toFixed(0)}万` : v.toFixed(0)) },
      },
    ],
    series: [
      {
        name: "价格",
        type: "line",
        data: prices,
        showSymbol: false,
        smooth: false,
        xAxisIndex: 0,
        yAxisIndex: 0,
        lineStyle: { width: 1.4, color: "#e8b339" },
        areaStyle: { color: "rgba(232,179,57,0.08)" },
        // 跌破昨收的部分染成绿色，这是行情软件的常见画法
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#5a6273", type: "dashed", width: 1 },
          label: { show: false },
          data: [{ yAxis: pre }],
        },
      },
      {
        name: "均价",
        type: "line",
        data: avgs,
        showSymbol: false,
        smooth: true,
        xAxisIndex: 0,
        yAxisIndex: 0,
        lineStyle: { width: 1, color: "#4a9eff" },
      },
      {
        name: "分钟量",
        type: "bar",
        data: volumes,
        xAxisIndex: 1,
        yAxisIndex: 2,
      },
    ],
  } as EChartsOption;
}