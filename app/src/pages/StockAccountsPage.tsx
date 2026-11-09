import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDownToLine, BriefcaseBusiness, CircleHelp, Plus, RefreshCw, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { importHoldingsFile, mergeTransactions, positionMarketValue, sumPositionValues, type StockAccount } from "@/lib/stockAccountImport";
import { valueAccountPositions, accountQuoteTime } from "@/lib/stockAccountMarket";
import { useAccountQuotes } from "@/lib/useAccountQuotes";
import { AccountTransactions } from "@/components/stock/AccountTransactions";
import { AccountStrategyAdvice } from "@/components/stock/AccountStrategyAdvice";
import { HoldingSwingPanel } from "@/components/stock/HoldingSwingPanel";
import { HoldingValuePanel } from "@/components/stock/HoldingValuePanel";
import { readStockAccounts as readAccounts, saveStockAccounts as saveAccounts } from "@/lib/stockAccountStorage";

const money = (n: number | null | undefined) => n == null ? "—" : `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const profitClass = (n: number | null) => n == null || n === 0 ? "" : n > 0 ? "text-red-500" : "text-emerald-600";

export default function StockAccountsPage() {
  const [search] = useSearchParams();
  const [accounts, setAccounts] = useState<StockAccount[]>(readAccounts);
  const accountsRef = useRef(accounts);
  const [tab, setTab] = useState("overview");
  const [selectedId, setSelectedId] = useState(() => readAccounts()[0]?.id ?? "");
  useEffect(() => { const id = search.get("account"); if (id && accountsRef.current.some(a => a.id === id)) { setSelectedId(id); setTab("overview"); } }, [search]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [broker, setBroker] = useState("同花顺投资账本");
  const [number, setNumber] = useState("");
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0];
  const quotePositions = selected?.positions ?? [];
  const market = useAccountQuotes(selected?.id ?? "", quotePositions);
  const valuedPositions = useMemo(() => valueAccountPositions(selected?.positions ?? [], market.quotes), [selected, market.quotes]);
  const totals = useMemo(() => {
    const positions = valuedPositions;
    return {
      market: sumPositionValues(positions, positionMarketValue),
      cost: sumPositionValues(positions, (p) => p.cost == null ? null : p.cost * p.quantity),
      profit: sumPositionValues(positions, (p) => p.profit),
    };
  }, [valuedPositions]);
  const persist = (next: StockAccount[]) => { saveAccounts(next); accountsRef.current = next; setAccounts(next); };

  const addAccount = () => {
    if (!name.trim()) return;
    const account = { id: crypto.randomUUID(), name: name.trim(), broker: broker.trim() || "其他券商", number: number.trim(), positions: [] };
    persist([...accounts, account]); setSelectedId(account.id); setName(""); setNumber(""); setDialogOpen(false); setMessage("");
  };

  const importFile = async (file?: File) => {
    if (!file || !selected || importing) return;
    setImporting(true);
    setMessage("");
    try {
      const imported = await importHoldingsFile(file, selected);
      const now = new Date().toLocaleString("zh-CN", { hour12: false });
      const current = accountsRef.current.find(a => a.id === selected.id);
      if (!current) return;
      const updated = {
        ...current, positions: imported.positions, sourceFile: file.name, sourceSheet: imported.sourceSheet, syncedAt: now,
        ...(imported.transactions === undefined ? {} : { transactions: mergeTransactions(current.transactions ?? [], imported.transactions), transactionsImportedAt: now }),
        ...(imported.closedPositions === undefined ? {} : { closedPositions: imported.closedPositions }),
      };
      persist(accountsRef.current.map((a) => a.id === selected.id ? updated : a));
      setMessage(`已从 ${file.name} 导入 ${imported.positions.length} 条持仓${imported.transactions === undefined ? "" : `、${imported.transactions.length} 条流水` }。${imported.hasAccountColumn ? "" : "文件未包含账号，已归入当前账户。"}`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "导入失败，请检查 Excel / CSV 文件"); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const deleteAccount = () => {
    if (!selected) return;
    const next = accounts.filter((a) => a.id !== selected.id); persist(next); setSelectedId(next[0]?.id ?? ""); setMessage("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
        <div><h1 className="text-base font-semibold">股票账户</h1><p className="mt-0.5 text-xs text-muted-foreground">按账户查看资产、持仓与盈亏</p></div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={!selected || market.loading} onClick={() => void market.refresh()}><RefreshCw className={`h-3.5 w-3.5 ${market.loading ? "animate-spin" : ""}`} />刷新行情</Button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,.tsv" className="hidden" onChange={(e) => void importFile(e.target.files?.[0])} />
          <Button size="sm" variant="outline" disabled={!selected || importing} onClick={() => fileRef.current?.click()}><RefreshCw className={`h-3.5 w-3.5 ${importing ? "animate-spin" : ""}`} /> {importing ? "正在导入…" : "导入账本文件"}</Button>
          <Button size="sm" disabled={importing} onClick={() => setDialogOpen(true)}><Plus className="h-3.5 w-3.5" /> 添加账户</Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="flex flex-wrap gap-2">
            {accounts.map((account) => <button key={account.id} disabled={importing} onClick={() => { setSelectedId(account.id); setMessage(""); }} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50 ${selected?.id === account.id ? "border-primary bg-primary/5 text-foreground" : "text-muted-foreground hover:bg-accent"}`}><Wallet className="h-4 w-4" />{account.name}<span className="text-xs text-muted-foreground">{account.number ? `尾号 ${account.number.slice(-4)}` : "未填账号"}</span></button>)}
            {accounts.length === 0 && <p className="py-2 text-sm text-muted-foreground">还没有股票账户，添加账户后可导入对应持仓。</p>}
          </div>

          {selected ? <>
            <AccountStrategyAdvice account={selected} />
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-3 text-primary"><BriefcaseBusiness className="h-5 w-5" /></div><div><div className="font-semibold">{selected.name}</div><div className="mt-1 text-xs text-muted-foreground">{selected.broker}{selected.number ? ` · 账号 ${selected.number}` : ""}</div></div></div>
                <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{selected.syncedAt ? `最近导入 ${selected.syncedAt}` : "尚未导入"}</span><Button variant="ghost" size="sm" disabled={importing} title="删除账户" onClick={deleteAccount}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></div>
              </CardContent>
            </Card>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>行情每 10 秒刷新 · 最近获取 {market.fetchedAt || "尚未获取"} · 每只证券标注报价时间，闭市报价可能为上一交易日</span><span>数量与成本来自最近导入，新增买卖需重新导入账本</span></div>
            {market.error && <p role="status" className="text-xs text-destructive">{market.error}</p>}
            <nav aria-label="账户功能" className="flex flex-wrap gap-1 border-b pb-2">{[["overview", "持仓概览"], ["swing", "波段操作"], ["transactions", "买卖流水"]].map(([key, label]) => <Button key={key} variant={tab === key ? "secondary" : "ghost"} size="sm" onClick={() => setTab(key)} aria-current={tab === key ? "page" : undefined}>{label}</Button>)}</nav>
            {tab === "overview" && <>
            <div className="grid gap-3 sm:grid-cols-3">
              {[{ label: "持仓市值", value: money(totals.market), style: "" }, { label: "估算持有盈亏", value: money(totals.profit), style: profitClass(totals.profit) }, { label: "持仓数量", value: `${selected.positions.length} 只`, style: "" }].map((item) => <Card key={item.label}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{item.label}</div><div className={`mt-2 text-xl font-semibold tabular-nums ${item.style}`}>{item.value}</div></CardContent></Card>)}
            </div>
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0"><div className="min-w-0"><CardTitle>持仓明细</CardTitle><CardDescription className="mt-1 break-all">{selected.sourceFile ? `来源：${selected.sourceFile} · ${selected.sourceSheet}` : "数据来自最近一次导入的账本快照"}</CardDescription></div><span className="shrink-0 text-xs text-muted-foreground">持仓成本 {money(totals.cost)}</span></CardHeader>
              <CardContent className="p-0">
                {valuedPositions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="border-y bg-muted/40 text-xs text-muted-foreground"><tr>{["证券", "持仓 / 可用", "成本价", "最新价", "市值", "估算持有盈亏"].map((h) => <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>)}</tr></thead><tbody>{valuedPositions.map((p) => <tr key={p.code} className="border-b last:border-0"><td className="px-4 py-3"><div className="font-medium">{p.name}</div><div className="mt-0.5 text-xs text-muted-foreground">{p.code}</div></td><td className="px-4 py-3 text-right tabular-nums">{p.quantity.toLocaleString()} / {p.available?.toLocaleString() ?? "—"}</td><td className="px-4 py-3 text-right tabular-nums">{money(p.cost)}</td><td className="px-4 py-3 text-right tabular-nums"><div>{money(p.price)}</div><div className="mt-1 text-[10px] text-muted-foreground">{p.priceSource === "market" ? accountQuoteTime(p.quoteTime) : "导入快照"}</div></td><td className="px-4 py-3 text-right tabular-nums">{money(positionMarketValue(p))}</td><td className={`px-4 py-3 text-right tabular-nums ${profitClass(p.profit)}`}>{money(p.profit)}</td></tr>)}</tbody></table></div> : <div className="flex flex-col items-center px-6 py-14 text-center"><ArrowDownToLine className="mb-3 h-8 w-8 text-muted-foreground/60" /><div className="text-sm font-medium">{selected.syncedAt ? "最近导入的账户当前无持仓" : "导入账户持仓开始查看"}</div><div className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">直接选择同花顺导出的“汇总持仓.xlsx”，无需转换格式。导入会替换当前账户的持仓快照。</div><Button className="mt-4" size="sm" variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}><ArrowDownToLine className="h-3.5 w-3.5" />选择 Excel / CSV 文件</Button></div>}
              </CardContent>
            </Card>
            <HoldingValuePanel key={selected.id} positions={valuedPositions} accountId={selected.id} />
            </>}
            {tab === "swing" && <HoldingSwingPanel key={`swing-${selected.id}`} account={selected} />}
            {tab === "transactions" && <AccountTransactions key={`transactions-${selected.id}`} account={selected} />}
          </> : <Card><CardContent className="flex flex-col items-center px-6 py-16 text-center"><Wallet className="mb-3 h-9 w-9 text-muted-foreground/50" /><div className="font-medium">添加你的第一个股票账户</div><p className="mt-1 text-sm text-muted-foreground">每个账户独立保存持仓快照和同步时间。</p><Button className="mt-4" onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4" />添加账户</Button></CardContent></Card>}

          {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
          <div className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" /><span>XLSX 同时读取持仓、交易记录和已清仓结果；流水重复导入会合并去重。未带账号的汇总数据归入当前账户。行情更新的是已有持仓的估值，导入后的新成交、分红与费用需重新导入；持有盈亏为估算值。文件在本机解析。</span></div>
        </div>
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>添加股票账户</DialogTitle><DialogDescription>填写账户标识，之后可单独导入该账户的持仓数据。</DialogDescription></DialogHeader>
          <div className="space-y-3 py-1"><label className="block space-y-1.5 text-sm"><span>账户名称</span><Input autoFocus placeholder="例如：主账户" value={name} onChange={(e) => setName(e.target.value)} /></label><label className="block space-y-1.5 text-sm"><span>券商 / 来源</span><Input placeholder="同花顺投资账本" value={broker} onChange={(e) => setBroker(e.target.value)} /></label><label className="block space-y-1.5 text-sm"><span>账号（可选）</span><Input placeholder="建议只填写尾号或自定义标识" value={number} onChange={(e) => setNumber(e.target.value)} /></label></div>
          <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button><Button onClick={addAccount} disabled={!name.trim()}>保存账户</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
