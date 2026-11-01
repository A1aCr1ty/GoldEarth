import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { StockAccount } from "@/lib/stockAccountImport";
import type { PlanSeed } from "@/lib/accountTradePlan";

const money = (value: number | null) => value == null ? "—" : value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AccountTransactions({ account, onPlan }: { account: StockAccount; onPlan?: (seed: PlanSeed) => void }) {
  const [code, setCode] = useState("all");
  const [kind, setKind] = useState("trades");
  const [limit, setLimit] = useState(50);
  const transactions = account.transactions ?? [];
  const securities = [...new Map(transactions.filter((t) => t.code && t.side !== "other").map((t) => [t.code, t.name])).entries()];
  const filtered = transactions.filter((t) => (code === "all" || code === t.code) && (kind === "all" || t.side !== "other"));
  useEffect(() => { setLimit(50); }, [code, kind]);
  return <Card>
    <CardHeader className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>买卖与资金流水</CardTitle><div className="flex gap-2"><select className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="交易证券" value={code} onChange={(e) => setCode(e.target.value)}><option value="all">全部证券</option>{securities.map(([c, name]) => <option key={c} value={c}>{name} · {c}</option>)}</select><select className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="交易类型" value={kind} onChange={(e) => setKind(e.target.value)}><option value="trades">仅买入 / 卖出</option><option value="all">全部流水（含分红、转账）</option></select></div></div>
      <CardDescription>{transactions.length ? `共 ${transactions.length} 条流水，当前筛选 ${filtered.length} 条；已清仓结果 ${account.closedPositions?.length ?? 0} 条。交易导入时间：${account.transactionsImportedAt ?? "未知"}。` : "重新导入带“交易记录”工作表的 XLSX，即可查看历史买卖。"}</CardDescription>
    </CardHeader>
    <CardContent className="p-0">
      {filtered.length ? <><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="border-y bg-muted/40 text-xs text-muted-foreground"><tr>{["成交日期", "证券", "类型", "数量", "成交价", "成交金额", "费用", "发生金额", "计划"].map((title) => <th key={title} className="px-4 py-3 text-right first:text-left">{title}</th>)}</tr></thead><tbody>{filtered.slice(0, limit).map((t) => <tr key={t.id} className="border-b last:border-0"><td className="px-4 py-3 text-xs">{t.date}<div className="text-muted-foreground">{t.time}</div></td><td className="px-4 py-3 text-right"><div>{t.name || "资金流水"}</div><div className="text-xs text-muted-foreground">{t.code}</div></td><td className={`px-4 py-3 text-right ${t.side === "buy" ? "text-red-500" : t.side === "sell" ? "text-emerald-600" : "text-muted-foreground"}`}>{t.kind}</td><td className="px-4 py-3 text-right tabular-nums">{t.quantity?.toLocaleString() ?? "—"}</td><td className="px-4 py-3 text-right tabular-nums">{money(t.price)}</td><td className="px-4 py-3 text-right tabular-nums">{money(t.amount)}</td><td className="px-4 py-3 text-right tabular-nums">{money(t.fee)}</td><td className="px-4 py-3 text-right tabular-nums">{money(t.cashAmount)}</td><td className="px-4 py-3 text-right">{onPlan && t.side !== "other" && <Button size="sm" variant="ghost" onClick={() => onPlan({ code: t.code, name: t.name, price: t.side === "buy" ? t.price : null, quantity: t.quantity, transactionId: t.id, intent: t.side === "buy" ? "hold" : "sell" })}>制定计划</Button>}</td></tr>)}</tbody></table></div>{filtered.length > limit && <div className="p-3 text-center"><Button size="sm" variant="outline" onClick={() => setLimit((v) => v + 50)}>再显示 50 条（已显示 {limit} / {filtered.length}）</Button></div>}</> : <p className="p-8 text-center text-sm text-muted-foreground">没有符合筛选条件的交易记录</p>}
    </CardContent>
  </Card>;
}
