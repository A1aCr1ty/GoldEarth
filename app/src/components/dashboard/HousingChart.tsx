import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, DataZoomComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { monthIndex, windowPoints, type HousingSeries } from "@/lib/housing";
echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);
export function HousingChart({ series, months }: { series: HousingSeries; months: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const chart = echarts.init(el.current);
    const resize = new ResizeObserver(() => chart.resize()); resize.observe(el.current);
    const points = windowPoints(series, months), first = points[0], last = points[points.length - 1];
    const labels: string[] = [], values: (number | null)[] = [];
    if (first && last) for (let i = monthIndex(first.month); i <= monthIndex(last.month); i++) {
      const month = `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`;
      labels.push(month); values.push(points.find(p => p.month === month)?.value ?? null);
    }
    chart.setOption({ animation: false, color: ["#8b5cf6"], tooltip: { trigger: "axis", valueFormatter: (v: unknown) => `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${series.unit}` },
      grid: { left: 72, right: 24, top: 24, bottom: 64 }, xAxis: { type: "category", data: labels, boundaryGap: false, axisLabel: { color: "#9099aa" } },
      yAxis: { type: "value", scale: true, axisLabel: { color: "#9099aa" }, splitLine: { lineStyle: { color: "rgba(128,128,128,.15)" } } },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 8 }], series: [{ name: series.name, type: "line", data: values, connectNulls: false, symbolSize: 6, smooth: false, lineStyle: { width: 2 }, areaStyle: { opacity: 0.05 } }] });
    return () => { resize.disconnect(); chart.dispose(); };
  }, [series, months]);
  return <div ref={el} className="h-[310px] w-full" role="img" aria-label={`${series.name}，${series.unit}，月度价格走势。下方提供完整数据表。`} />;
}
