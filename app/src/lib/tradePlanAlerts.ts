import { planInputSignature, planQuoteFresh, planThresholds, validPlanAlertRule, ALERT_ACTIONS, type AccountTradePlan, type PlanAlertRule } from "./accountTradePlan";
import type { Quote } from "@/types";

export interface TradePlanAlert { id: string; key: string; accountId: string; planId: string; title: string; detail: string; createdAt: string; read: boolean }
export const TRADE_ALERTS_KEY = "goldearth.trade-alerts.v1";
function fingerprint(value: unknown) {
  const text = JSON.stringify(value); let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${a >>> 0}-${b >>> 0}`;
}
export function chinaDay(now: number) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now)); }
export function tradingSession(now: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  const minute = Number(part("hour")) * 60 + Number(part("minute"));
  return !["Sat", "Sun"].includes(part("weekday") ?? "") && ((minute >= 570 && minute <= 690) || (minute >= 780 && minute <= 900));
}
export function alertRuleLabel(rule: PlanAlertRule) { return `${ALERT_ACTIONS[rule.action]} · ${rule.condition === "between" ? `¥${rule.price}～¥${rule.upperPrice}` : `${rule.condition === "above" ? "≥" : "≤"} ¥${rule.price}`}`; }
export function planAlertRules(plan: AccountTradePlan): PlanAlertRule[] {
  const { takeProfitPrice, stopLossPrice } = planThresholds(plan);
  const rules: PlanAlertRule[] = [...(plan.reminders?.rules ?? [])];
  if (takeProfitPrice != null) rules.push({ id: "plan-profit", action: "sell", condition: "above", price: takeProfitPrice, confirmation: "原计划止盈观察价已触及；核对原计划是否仅要求复核，以及实际可用股数后再决定操作。" });
  if (stopLossPrice != null) rules.push({ id: "plan-stop", action: "stop", condition: "below", price: stopLossPrice, confirmation: "原计划止损观察价已触及；核对最新价格、原计划及实际可用数量。" });
  return rules.filter(validPlanAlertRule);
}
export function planReminderReady(plan: AccountTradePlan) { return plan.status === "active" && plan.reminders?.enabled === true && plan.reminders.inputSignature === planInputSignature(plan); }
export function evaluatePlanAlerts(accountId: string, plan: AccountTradePlan, quote: Quote | undefined, now: number): TradePlanAlert[] {
  if (!planReminderReady(plan)) return [];
  const day = chinaDay(now);
  const create = (ruleId: string, title: string, detail: string, definition: unknown): TradePlanAlert => ({ id: crypto.randomUUID(), key: JSON.stringify([day, accountId, plan.id, fingerprint(planInputSignature(plan)), ruleId, fingerprint(definition)]), accountId, planId: plan.id, title: `${plan.name} · ${title}`, detail, createdAt: new Date(now).toISOString(), read: false });
  if (plan.expiresOn && plan.expiresOn <= day) return [create("review", "计划已到复核日期", `复核日期 ${plan.expiresOn}，请先检查原目标及波段条件，价格提醒已暂停。`, plan.expiresOn)];
  if (!tradingSession(now) || !planQuoteFresh(quote, now)) return [];
  return planAlertRules(plan).filter(r => r.condition === "above" ? quote!.price >= r.price : r.condition === "below" ? quote!.price <= r.price : quote!.price >= r.price && quote!.price <= r.upperPrice!).map(r => create(r.id, ALERT_ACTIONS[r.action], `报价 ¥${quote!.price}（${quote!.time}）触及 ${alertRuleLabel(r)}。仅价格条件已触发。${r.confirmation}`, r));
}
