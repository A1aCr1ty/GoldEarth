import { useState } from "react";
import { Bell, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ALERT_ACTIONS, planInputSignature, validPlanAlertRule, type AccountTradePlan, type PlanAlertRule } from "@/lib/accountTradePlan";
import { alertRuleLabel, planAlertRules } from "@/lib/tradePlanAlerts";

export function PlanReminderSettings({ plan, update }: { plan: AccountTradePlan; update: (id: string, change: (p: AccountTradePlan) => AccountTradePlan) => void }) {
  const [rules, setRules] = useState<PlanAlertRule[]>(plan.reminders?.rules ?? []);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const signature = planInputSignature(plan);
  const outdated = !!plan.reminders?.enabled && plan.reminders.inputSignature !== signature;
  const closed = plan.status === "cancelled" || plan.status === "completed";
  const analysis = plan.analysis?.inputSignature === signature ? plan.analysis.result : plan.savedRecommendation?.inputSignature === signature ? plan.savedRecommendation.result : undefined;
  const className = "h-9 rounded-md border bg-background px-2 text-xs";
  function change(id: string, fields: Partial<PlanAlertRule>) { setRules(previous => previous.map(r => r.id === id ? { ...r, ...fields } : r)); }
  function enable() {
    if (closed) return;
    if (rules.some(r => !validPlanAlertRule(r))) { setError("请填写大于 0 的提醒价，区间上限不能低于下限。"); return; }
    if (!planAlertRules({ ...plan, reminders: { enabled: true, inputSignature: signature, rules } }).length && !plan.expiresOn) { setError("请至少设置一个价格条件或计划复核日期，再启用提醒。"); return; }
    try {
      update(plan.id, p => ({ ...p, status: "active", reminders: { enabled: true, inputSignature: planInputSignature(p), rules } }));
      setError(""); setNotice("提醒已保存并启用。同一条件每天提醒一次，修改条件后需再次保存。");
    } catch (e) { setError(`保存提醒失败：${e}`); }
  }
  return <section className="space-y-3 rounded-lg border p-4 text-sm"><h3 className="flex items-center gap-2 font-semibold"><Bell className="h-4 w-4" />根据计划与行情提醒操作</h3>
    <p className="text-xs text-muted-foreground">应用运行期间每 10 秒检查，在其他页面也显示弹窗。关闭应用或电脑休眠期间不检查。仅价格条件可自动判断，量价确认、卖出后接回、可用股数与 T+1 仍须核对。</p>
    <p className="text-xs">状态：{closed ? "计划已结束，提醒已停止" : outdated ? "计划已修改，提醒已暂停，请确认后重新启用" : plan.reminders?.enabled && plan.status === "active" ? "已启用" : "未启用 / 已暂停"}</p>
    <p className="text-xs text-muted-foreground">原计划止盈止损会一并检查；以下可设置独立的波段价格观察条件。无有效新报价时不触发价格提醒。</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={closed || !analysis?.alertRules?.length} onClick={() => { setRules(analysis!.alertRules!.map(r => ({ ...r, id: crypto.randomUUID() }))); setNotice("AI 价格条件已带入，请核对后点击保存并启用提醒。"); }}>带入 AI 波段提醒条件</Button><Button size="sm" variant="ghost" disabled={closed || rules.length >= 8} onClick={() => setRules([...rules, { id: crypto.randomUUID(), action: "buy", condition: "below", price: 0, confirmation: "核对量价确认、实际可用数量和操作权限。" }])}><Plus className="h-3.5 w-3.5" />添加价格条件</Button></div>
    {!analysis?.alertRules?.length && <p className="text-xs text-muted-foreground">当前 AI 建议没有可直接监测的价格条件，可重新生成波段方案或手动填写；文字中的价格不会自动当作下单或提醒条件。</p>}
    {rules.map(r => <div key={r.id} className="space-y-2 rounded-md bg-muted/30 p-3"><div className="flex flex-wrap gap-2"><select aria-label="提醒操作" className={className} value={r.action} disabled={closed} onChange={e => change(r.id, { action: e.target.value as PlanAlertRule["action"] })}>{Object.entries(ALERT_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><select aria-label="价格触发方式" className={className} value={r.condition} disabled={closed} onChange={e => change(r.id, { condition: e.target.value as PlanAlertRule["condition"] })}><option value="below">价格 ≤</option><option value="above">价格 ≥</option><option value="between">进入区间</option></select><Input aria-label="提醒价格或区间下限" className="w-28" type="number" min="0" step="any" value={r.price || ""} disabled={closed} onChange={e => change(r.id, { price: Number(e.target.value) })} />{r.condition === "between" && <Input aria-label="提醒区间上限" className="w-28" type="number" min="0" step="any" value={r.upperPrice ?? ""} disabled={closed} onChange={e => change(r.id, { upperPrice: Number(e.target.value) })} />}<Button size="sm" variant="ghost" aria-label="删除提醒条件" disabled={closed} onClick={() => setRules(rules.filter(item => item.id !== r.id))}><Trash2 className="h-3.5 w-3.5" /></Button></div><Input aria-label="触发后仍需确认的条件" value={r.confirmation} disabled={closed} onChange={e => change(r.id, { confirmation: e.target.value })} placeholder="例如：确认放量、已经卖出机动仓、可用股数…" /></div>)}
    <div className="flex gap-2"><Button size="sm" disabled={closed} onClick={enable}>保存并启用提醒</Button>{plan.reminders?.enabled && <Button size="sm" variant="outline" onClick={() => { try { update(plan.id, p => ({ ...p, reminders: p.reminders ? { ...p.reminders, enabled: false } : undefined })); setNotice("操作提醒已暂停。"); } catch (e) { setError(String(e)); } }}>暂停提醒</Button>}</div>
    {plan.reminders?.enabled && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">查看已保存的提醒条件</summary><ul className="mt-2 space-y-1">{planAlertRules(plan).map(r => <li key={r.id}>{alertRuleLabel(r)}</li>)}{plan.expiresOn && <li>计划复核日期：{plan.expiresOn}</li>}</ul></details>}
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}
