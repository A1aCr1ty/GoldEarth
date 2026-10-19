import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart, BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent, DataZoomComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { trackerAxis, type TrackerSeries } from "@/lib/trackers";
echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);
export function TrackerChart({ series, months, endMonth }: { series: TrackerSeries; months: number; endMonth?: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const chart = echarts.init(el.current), observer = new ResizeObserver(() => chart.resize()); observer.observe(el.current);
    const { labels, values } = trackerAxis(series, months, endMonth);
    chart.setOption({ animation: false, color: ["#8b5cf6"], tooltip: { trigger: "axis", valueFormatter: (v: unknown) => v == null ? "无观测" : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${series.unit}` }, grid: { left: 80, right: 20, top: 24, bottom: 64 }, xAxis: { type: "category", data: labels, axisLabel: { color: "#9099aa" } }, yAxis: { type: "value", scale: series.frequency !== "monthly", axisLabel: { color: "#9099aa" }, splitLine: { lineStyle: { color: "rgba(128,128,128,.15)" } } }, dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 8 }], series: [{ name: series.name, type: series.frequency === "monthly" ? "bar" : "line", data: values, connectNulls: false, showSymbol: true, symbolSize: 4, barMaxWidth: 32, smooth: false, areaStyle: { opacity: 0.05 } }] });
    return () => { observer.disconnect(); chart.dispose(); };
  }, [series, months, endMonth]);
  return <div ref={el} className="h-[320px] w-full" role="img" aria-label={`${series.name}趋势图，单位${series.unit}。完整数据见下表。`} />;
}
