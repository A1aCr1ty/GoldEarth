import { INTENT_LABELS, type PlanRecommendation } from "@/lib/accountTradePlan";
import { alertRuleLabel } from "@/lib/tradePlanAlerts";

function Conditions({ items }: { items: string[] }) {
  if (!items.length) return <span className="text-muted-foreground">待确认</span>;
  return <div><p className={`${items[0].length > 70 ? "line-clamp-2" : ""} leading-5`}>{items[0]}</p>{(items.length > 1 || items[0].length > 70) && <details className="mt-1"><summary className="cursor-pointer text-xs text-muted-foreground">完整条件{items.length > 1 ? `（${items.length}条）` : ""}</summary><ul className="mt-2 list-disc space-y-1 pl-4">{items.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}</div>;
}

export function PlanRecommendationView({ result }: { result: PlanRecommendation }) {
  const swing = result.swingPlan;
  const rows: [string, string[], string[]][] = swing ? [
    ["观察区", [swing.observation || "待补充观察区与企稳依据"], []],
    ["首笔试仓", swing.buyConditions, ["buy"]],
    ["第一兑现区", swing.firstTarget ? [swing.firstTarget] : swing.sellConditions, ["sell"]],
    ["第二兑现区", [swing.secondTarget || "待补充第二目标及剩余仓位安排"], []],
    ["卖出后接回", swing.buybackConditions, ["buyback"]], ["突破应对", swing.breakoutPlan, ["breakout"]],
    ["止损 / 停止", swing.stopConditions, ["stop"]],
  ] : [["买入 / 加仓", result.entryConditions, ["buy"]], ["减仓 / 卖出", result.exitConditions, ["sell"]], ["失效 / 停止", result.invalidation, ["stop"]]];
  return <div className="space-y-3 text-sm">
    <div className="flex items-start gap-3 rounded-md bg-primary/5 px-3 py-2"><span className="shrink-0 rounded border border-primary/20 px-2 py-0.5 text-xs font-semibold">{INTENT_LABELS[result.action]}</span><Conditions items={[result.summary]} /></div>
    {swing?.marketBasis && <p className="text-xs text-muted-foreground">行情依据 · {swing.marketBasis}</p>}
    {swing?.riskReward && <div className="rounded-md border p-3 text-xs"><strong>收益与风险测算</strong><p className="mt-1 whitespace-pre-wrap">{swing.riskReward}</p></div>}
    {swing && <div className="grid gap-2 text-xs sm:grid-cols-2"><div className="rounded border px-3 py-2"><span className="text-muted-foreground">底仓 · </span><Conditions items={[swing.corePosition]} /></div><div className="rounded border px-3 py-2"><span className="text-muted-foreground">机动仓 · </span><Conditions items={[swing.tradingPosition]} /></div></div>}
    <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[540px] text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="w-28 px-3 py-2 text-left font-medium">操作</th><th className="px-3 py-2 text-left font-medium">触发条件 / 执行方式</th><th className="w-44 px-3 py-2 text-left font-medium">价格观察条件</th></tr></thead><tbody>{rows.map(([label, items, actions]) => <tr key={label} className="border-t align-top"><th scope="row" className="px-3 py-3 text-left font-medium">{label}</th><td className="px-3 py-3"><Conditions items={items} /></td><td className="px-3 py-3 text-muted-foreground">{result.alertRules?.filter(rule => actions.includes(rule.action)).map(rule => <div key={rule.id} className="mb-1">{alertRuleLabel(rule).split(" · ")[1]}</div>)}{!result.alertRules?.some(rule => actions.includes(rule.action)) && "待确认"}</td></tr>)}</tbody></table></div>
    <div className="text-xs"><span className="font-medium">下次复核 · </span><Conditions items={[swing?.reviewCycle || result.nextReview || "待确定"]} /></div>
    <details className="rounded-md border px-3 py-2 text-xs text-muted-foreground"><summary className="cursor-pointer">分析依据与风险</summary><div className="mt-3 space-y-3">{result.planAssessment && <section><h4 className="font-medium text-foreground">原计划评估</h4><p className="mt-1 leading-5 whitespace-pre-wrap">{result.planAssessment}</p></section>}{([["判断依据", result.reasoning], ["执行顺序", result.executionSteps ?? []], ["失效条件", result.invalidation], ["风险与缺失数据", result.risks]] as [string, string[]][]).filter(([, items]) => items.length).map(([title, items]) => <section key={title}><h4 className="font-medium text-foreground">{title}</h4><ul className="mt-1 list-disc space-y-1 pl-4">{items.map((item, i) => <li key={i}>{item}</li>)}</ul></section>)}{result.alertRules?.length ? <section><h4 className="font-medium text-foreground">提醒后仍须确认</h4>{result.alertRules.map(rule => <p className="mt-1" key={rule.id}>{alertRuleLabel(rule)}：{rule.confirmation}</p>)}</section> : null}</div></details>
  </div>;
}
