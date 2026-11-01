import type { AccountTradePlan } from "./accountTradePlan";

export interface Position {
  code: string;
  name: string;
  quantity: number;
  available: number | null;
  cost: number | null;
  price: number | null;
  profit: number | null;
  marketValue?: number | null;
}

export interface AccountTransaction {
  id: string;
  date: string;
  time: string;
  code: string;
  name: string;
  kind: string;
  side: "buy" | "sell" | "other";
  quantity: number | null;
  price: number | null;
  amount: number | null;
  cashAmount: number | null;
  fee: number | null;
}

export interface ClosedPosition {
  code: string; name: string; date: string; profit: number | null;
  buyPrice: number | null; sellPrice: number | null; holdingDays: number | null;
}

export interface StockAccount {
  id: string; name: string; broker: string; number: string; positions: Position[];
  transactions?: AccountTransaction[]; closedPositions?: ClosedPosition[];
  syncedAt?: string; sourceFile?: string; sourceSheet?: string; transactionsImportedAt?: string;
  tradePlans?: AccountTradePlan[];
}

type Cell = unknown;
export interface HoldingSheet { sheet: string; data: Cell[][] }
export interface AccountIdentifier { name: string; number: string }
export interface HoldingsImport {
  positions: Position[];
  sourceSheet: string;
  hasAccountColumn: boolean;
  transactions?: AccountTransaction[];
  closedPositions?: ClosedPosition[];
}

const ALIASES = {
  code: ["证券代码", "股票代码", "代码", "stockcode", "code"],
  name: ["证券名称", "股票名称", "证券简称", "名称", "stockname", "name"],
  quantity: ["股票余额", "持仓数量", "持有数量", "证券数量", "数量", "持仓股数", "quantity"],
  available: ["可用股份", "可卖数量", "可用数量", "available"],
  cost: ["单位成本", "摊薄成本", "成本价", "持仓成本", "买入均价", "cost"],
  price: ["最新价", "市价", "当前价", "price"],
  profit: ["持有盈亏", "浮动盈亏", "持仓盈亏", "盈亏", "profit"],
  marketValue: ["持有金额", "持仓市值", "证券市值", "市值", "marketvalue"],
  account: ["资金账号", "证券账号", "账户名称", "账号", "account"],
};

const normalizeHeader = (cell: Cell) => String(cell ?? "").replace(/^\uFEFF/, "").replace(/\s/g, "").replace(/[（(](?:元|股|人民币|CNY)[）)]$/, "").toLowerCase();
const columnIndex = (headers: string[], aliases: string[]) => {
  // 按指标名称精确匹配，避免将“当日盈亏率”误认成“持有盈亏”。
  for (const alias of aliases) {
    const index = headers.indexOf(alias.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
};

function columns(row: Cell[]) {
  const headers = row.map(normalizeHeader);
  return Object.fromEntries(Object.entries(ALIASES).map(([key, aliases]) => [key, columnIndex(headers, aliases)])) as Record<keyof typeof ALIASES, number>;
}

function numeric(cell: Cell, label: string, row: number): number | null {
  if (cell == null || String(cell).trim() === "" || /^(?:--?|—|N\/A)$/i.test(String(cell).trim())) return null;
  const value = typeof cell === "number" ? cell : Number(String(cell).replace(/[￥¥,，\s]/g, ""));
  if (!Number.isFinite(value) || typeof cell === "boolean" || cell instanceof Date) throw new Error(`第 ${row} 行的${label}不是有效数字`);
  return value;
}

function securityCode(cell: Cell) {
  const value = String(cell ?? "").trim().replace(/^['‘]/, "");
  return /^\d{1,6}$/.test(value) && (typeof cell === "number" || value.length < 5) ? value.padStart(6, "0") : value;
}

function tableWithColumns(sheet: HoldingSheet, required: string[]) {
  const headerIndex = sheet.data.slice(0, 20).findIndex((row) => required.every((title) => row.map(normalizeHeader).includes(title)));
  if (headerIndex < 0) throw new Error(`“${sheet.sheet}”工作表缺少 ${required.join("、")} 列`);
  const headers = sheet.data[headerIndex].map(normalizeHeader);
  return sheet.data.slice(headerIndex + 1).map((row, i) => ({
    get: (...aliases: string[]) => row[columnIndex(headers, aliases)],
    rowNumber: headerIndex + i + 2,
  }));
}

function dateText(value: Cell, row: number): string {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").trim().replace(/[/.]/g, "-");
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (!match) throw new Error(`第 ${row} 行的交易日期无效`);
  const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error(`第 ${row} 行的交易日期无效`);
  return date;
}

function belongsToAccount(value: Cell, account: AccountIdentifier) {
  const text = String(value ?? "").trim();
  return !text || [account.name.trim(), account.number.trim()].filter(Boolean).includes(text);
}

export function parseTransactionSheets(sheets: HoldingSheet[], account: AccountIdentifier): AccountTransaction[] | undefined {
  const sheet = sheets.find((s) => ["交易记录", "交易流水", "成交记录"].includes(s.sheet.trim()));
  if (!sheet) return undefined;
  const occurrences = new Map<string, number>();
  const result: AccountTransaction[] = [];
  for (const { get, rowNumber } of tableWithColumns(sheet, ["成交日期", "交易类别"])) {
    if (!get("成交日期") || /^(合计|汇总|总计)$/.test(String(get("成交日期")))) continue;
    if (!belongsToAccount(get("资金账号", "证券账号", "账户名称", "账号", "account"), account)) continue;
    const kind = String(get("交易类别") ?? "").trim();
    if (!kind) throw new Error(`交易记录第 ${rowNumber} 行缺少交易类别`);
    const record = {
      date: dateText(get("成交日期"), rowNumber),
      time: String(get("成交时间") ?? "").trim(),
      code: get("代码", "证券代码", "股票代码") == null ? "" : securityCode(get("代码", "证券代码", "股票代码")),
      name: String(get("名称", "证券名称", "股票名称") ?? "").trim(), kind,
      side: (/^(?:证券|股票)?买入$/.test(kind) ? "buy" : /^(?:证券|股票)?卖出$/.test(kind) ? "sell" : "other") as AccountTransaction["side"],
      quantity: numeric(get("成交数量"), "成交数量", rowNumber),
      price: numeric(get("成交价格", "成交价"), "成交价格", rowNumber),
      amount: numeric(get("成交金额"), "成交金额", rowNumber),
      cashAmount: numeric(get("发生金额"), "发生金额", rowNumber),
      fee: numeric(get("费用", "手续费"), "费用", rowNumber),
    };
    if (record.side !== "other" && (!record.code || record.quantity == null || record.quantity <= 0 || record.price == null || record.price < 0)) throw new Error(`交易记录第 ${rowNumber} 行缺少有效的成交代码、数量或价格`);
    // 无成交编号的导出也可能有同日同价的多笔成交；按出现次数保留，重复导入时再对齐。
    const key = JSON.stringify(record);
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    result.push({ id: `${key}#${occurrence}`, ...record });
  }
  return result.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
}

export function parseClosedPositions(sheets: HoldingSheet[], account: AccountIdentifier): ClosedPosition[] | undefined {
  const sheet = sheets.find((s) => s.sheet.trim() === "已清仓");
  if (!sheet) return undefined;
  const result: ClosedPosition[] = [];
  for (const { get, rowNumber } of tableWithColumns(sheet, ["清仓日期", "代码", "名称"])) {
    if (!get("清仓日期") || /^(合计|汇总|总计)$/.test(String(get("清仓日期")))) continue;
    if (!belongsToAccount(get("资金账号", "证券账号", "账户名称", "账号"), account)) continue;
    result.push({
      code: securityCode(get("代码")), name: String(get("名称") ?? ""), date: dateText(get("清仓日期"), rowNumber),
      profit: numeric(get("总盈亏"), "总盈亏", rowNumber), buyPrice: numeric(get("买入均价"), "买入均价", rowNumber),
      sellPrice: numeric(get("卖出均价"), "卖出均价", rowNumber), holdingDays: numeric(get("持仓天数"), "持仓天数", rowNumber),
    });
  }
  return result.sort((a, b) => b.date.localeCompare(a.date));
}

export function mergeTransactions(previous: AccountTransaction[], imported: AccountTransaction[]) {
  const records = new Map(previous.map((r) => [r.id, r]));
  for (const record of imported) records.set(record.id, record);
  return [...records.values()].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
}

export function parseHoldingSheets(sheets: HoldingSheet[], account: AccountIdentifier, allowEmpty = false): HoldingsImport {
  const holdingSheets = sheets.filter((s) => ["持仓数据", "汇总持仓", "持仓明细"].includes(s.sheet.trim()));
  const candidates = (holdingSheets.length ? holdingSheets : sheets).map((sheet) => {
    const headerIndex = sheet.data.slice(0, 20).findIndex((row) => {
      const col = columns(row);
      return col.code >= 0 && col.name >= 0 && col.quantity >= 0;
    });
    return { ...sheet, headerIndex };
  }).filter((sheet) => sheet.headerIndex >= 0);
  if (!candidates.length) throw new Error("未找到持仓工作表，需要包含代码、名称和持有数量列");
  if (candidates.length > 1) throw new Error("发现多个持仓工作表，请只保留需要导入的持仓表后重试");

  const { sheet, data, headerIndex } = candidates[0];
  const col = columns(data[headerIndex]);
  const positions: Position[] = [];
  const codes = new Set<string>();
  let unmatched = 0;
  data.slice(headerIndex + 1).forEach((row, i) => {
    const code = securityCode(row[col.code]);
    const name = String(row[col.name] ?? "").trim();
    if (!code || /^(?:合计|总计|汇总)$/.test(code) || /^(?:合计|总计)$/.test(name)) return;
    const rowAccount = String(row[col.account] ?? "").trim();
    if (rowAccount && ![account.name.trim(), account.number.trim()].filter(Boolean).includes(rowAccount)) { unmatched++; return; }
    const rowNumber = headerIndex + i + 2;
    const quantity = numeric(row[col.quantity], "持有数量", rowNumber);
    if (quantity === 0) return;
    if (quantity == null || quantity < 0 || !name) throw new Error(`第 ${rowNumber} 行缺少有效的名称或持有数量`);
    if (codes.has(code)) throw new Error(`第 ${rowNumber} 行证券代码重复，请先将同一证券的持仓合并`);
    codes.add(code);
    const cost = numeric(row[col.cost], "成本价", rowNumber);
    const price = numeric(row[col.price], "最新价", rowNumber);
    const profit = numeric(row[col.profit], "持有盈亏", rowNumber);
    positions.push({
      code, name, quantity, cost, price,
      available: numeric(row[col.available], "可用数量", rowNumber),
      marketValue: numeric(row[col.marketValue], "持仓市值", rowNumber) ?? (price == null ? null : price * quantity),
      profit: profit ?? (cost == null || price == null ? null : (price - cost) * quantity),
    });
  });
  if (!positions.length && (!allowEmpty || unmatched)) throw new Error(unmatched ? "没有找到属于当前账户的持仓，请核对账户名称或账号" : "工作表中没有可导入的持仓记录");
  return { positions, sourceSheet: sheet, hasAccountColumn: col.account >= 0 };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const separator = (text.split(/\r?\n/, 1)[0].includes("\t")) ? "\t" : ",";
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === separator && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else cell += c;
  }
  if (quoted) throw new Error("CSV 引号未闭合，请检查导出文件");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

export async function importHoldingsFile(file: File, account: AccountIdentifier): Promise<HoldingsImport> {
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readExcelFile } = await import("read-excel-file/universal");
    let sheets: HoldingSheet[];
    try { sheets = await readExcelFile(await file.arrayBuffer()); }
    catch { throw new Error("无法读取 XLSX 文件，请确认文件未损坏、未加密，并重新从账本导出"); }
    return { ...parseHoldingSheets(sheets, account, true), transactions: parseTransactionSheets(sheets, account), closedPositions: parseClosedPositions(sheets, account) };
  }
  if (!/\.(csv|txt|tsv)$/i.test(file.name)) throw new Error("请选择同花顺导出的 .xlsx 文件，或 CSV / TSV 文件");
  const buffer = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buffer);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030").decode(buffer);
  return parseHoldingSheets([{ sheet: file.name, data: parseCsv(text) }], account);
}

export function positionMarketValue(position: Position) {
  return position.marketValue ?? (position.price == null ? null : position.price * position.quantity);
}

export function sumPositionValues(positions: Position[], value: (position: Position) => number | null): number | null {
  let total = 0;
  for (const position of positions) {
    const amount = value(position);
    if (amount == null) return null;
    total += amount;
  }
  return total;
}
