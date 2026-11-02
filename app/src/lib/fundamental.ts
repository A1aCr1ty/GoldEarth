import type { FinancialReport, FinancialReports, Quote } from "@/types";

export type FactorStatus = "good" | "neutral" | "risk" | "missing";

export interface FundamentalFactor {
  key: string;
  label: string;
  weight: number;
  earned: number | null;
  status: FactorStatus;
  value: string;
  rule: string;
}

export interface FundamentalAnalysis {
  report: FinancialReport;
  score: number | null;
  coverage: number;
  rating: string;
  annualizedRoe: number | null;
  cashToProfit: number | null;
  financialInstitution: boolean;
  factors: FundamentalFactor[];
  strengths: string[];
  risks: string[];
  observations: string[];
}

export interface QuantAdviceInput {
  ready: boolean;
  action?: string;
  advice?: string;
  reason?: string;
  bias?: number;
  date?: string;
}

export interface ModelAdviceInput {
  action: "wait" | "reduce" | "hold" | "buy";
  summary: string;
  asof?: string;
}

export interface CombinedAdvice {
  action: "买入候选" | "持有观察" | "减仓复核" | "观望" | "暂缓追涨" | "数据不足";
  summary: string;
  reasons: string[];
}

function chinaDate() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function percent(value: number | null | undefined) {
  return finite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "暂无";
}

export function latestFinancialReport(data: FinancialReports | null, today = chinaDate()) {
  if (!data) return null;
  return data.reports
    .filter(report => report.code === data.code && validDate(report.reportDate) && report.reportDate <= today &&
      (!report.noticeDate || (validDate(report.noticeDate) && report.noticeDate <= today)))
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0] ?? null;
}

function factor(key: string, label: string, weight: number, value: number | null, rule: string,
  display: string, grade: (value: number) => [number, FactorStatus]): FundamentalFactor {
  if (!finite(value)) return { key, label, weight, earned: null, status: "missing", value: "暂无", rule };
  const [earned, status] = grade(value);
  return { key, label, weight, earned, status, value: display, rule };
}

export function analyzeFundamentals(report: FinancialReport): FundamentalAnalysis {
  const month = Number(report.reportDate.slice(5, 7));
  const periodMonths = [3, 6, 9, 12].includes(month) ? month : 12;
  const annualizedRoe = finite(report.roeWeighted) ? report.roeWeighted * 12 / periodMonths : null;
  const cashToProfit = finite(report.operatingCashFlow) && finite(report.netProfit) && report.netProfit > 0
    ? report.operatingCashFlow / report.netProfit
    : null;
  const financialInstitution = /银行|保险|证券/.test(report.orgType);
  const factors: FundamentalFactor[] = [
    factor("revenue", "营收增长", 15, report.revenueYoy, "同比 ≥10% 得满分；0～10% 得 10 分；-10%～0 得 5 分", percent(report.revenueYoy), value =>
      [value >= 10 ? 15 : value >= 0 ? 10 : value >= -10 ? 5 : 0, value >= 10 ? "good" : value >= 0 ? "neutral" : "risk"]),
    factor("profit", "利润增长", 15, report.netProfitYoy, "同比 ≥10% 得满分；0～10% 得 10 分；-10%～0 得 5 分", percent(report.netProfitYoy), value =>
      [value >= 10 ? 15 : value >= 0 ? 10 : value >= -10 ? 5 : 0, value >= 10 ? "good" : value >= 0 ? "neutral" : "risk"]),
    factor("roe", "盈利能力", 25, annualizedRoe, "加权 ROE 按报告期简单年化：≥15% 得满分；≥8% 得 15 分；>0 得 5 分",
      finite(annualizedRoe) ? `${annualizedRoe.toFixed(2)}%（年化参考）` : "暂无", value =>
        [value >= 15 ? 25 : value >= 8 ? 15 : value > 0 ? 5 : 0, value >= 15 ? "good" : value >= 8 ? "neutral" : "risk"]),
  ];
  if (financialInstitution) {
    factors.push(
      { key: "cash", label: "现金流质量", weight: 20, earned: null, status: "missing", value: "金融行业不适用通用阈值", rule: "经营现金流不作实体企业口径评分" },
      { key: "debt", label: "杠杆水平", weight: 15, earned: null, status: "missing", value: "金融行业不适用通用阈值", rule: "金融企业负债结构需使用行业专属指标" },
    );
  } else {
    factors.push(
      factor("cash", "现金流质量", 20, cashToProfit, "经营现金流 / 归母净利润：≥1 得满分；≥0.7 得 12 分；≥0 得 5 分",
        finite(cashToProfit) ? cashToProfit.toFixed(2) : "暂无", value =>
          [value >= 1 ? 20 : value >= .7 ? 12 : value >= 0 ? 5 : 0, value >= 1 ? "good" : value >= .7 ? "neutral" : "risk"]),
      factor("debt", "杠杆水平", 15, report.debtRatio, "资产负债率 ≤50% 得满分；≤70% 得 10 分；≤85% 得 5 分（通用初筛）",
        percent(report.debtRatio), value => [value <= 50 ? 15 : value <= 70 ? 10 : value <= 85 ? 5 : 0, value <= 50 ? "good" : value <= 70 ? "neutral" : "risk"]),
    );
  }
  factors.push(factor("margin", "销售净利率", 10, report.netMargin, "≥15% 得满分；≥5% 得 6 分；>0 得 3 分", percent(report.netMargin), value =>
    [value >= 15 ? 10 : value >= 5 ? 6 : value > 0 ? 3 : 0, value >= 15 ? "good" : value >= 5 ? "neutral" : "risk"]));

  const availableWeight = factors.reduce((sum, item) => sum + (item.earned === null ? 0 : item.weight), 0);
  const earned = factors.reduce((sum, item) => sum + (item.earned ?? 0), 0);
  const coverage = Math.round(availableWeight);
  const score = availableWeight >= 50 ? Math.round(earned / availableWeight * 100) : null;
  const rating = score === null ? "数据不足" : score >= 75 ? "较稳健" : score >= 55 ? "中性" : "偏弱";
  const strengths: string[] = [];
  const risks: string[] = [];
  if (finite(report.revenueYoy) && finite(report.netProfitYoy) && report.revenueYoy >= 10 && report.netProfitYoy >= 10)
    strengths.push(`营收与归母净利润同比均增长至少 10%（${percent(report.revenueYoy)} / ${percent(report.netProfitYoy)}）。`);
  if (finite(annualizedRoe) && annualizedRoe >= 15) strengths.push(`简单年化 ROE 为 ${annualizedRoe.toFixed(2)}%，达到盈利能力规则阈值。`);
  if (finite(cashToProfit) && cashToProfit >= 1 && !financialInstitution) strengths.push(`经营现金流为归母净利润的 ${cashToProfit.toFixed(2)} 倍，利润现金含量达到规则阈值。`);
  if (finite(report.debtRatio) && report.debtRatio <= 50 && !financialInstitution) strengths.push(`资产负债率 ${report.debtRatio.toFixed(2)}%，处于通用初筛的较低区间。`);
  if (finite(report.revenueYoy) && report.revenueYoy < 0) risks.push(`累计营收同比下降 ${Math.abs(report.revenueYoy).toFixed(2)}%。`);
  if (finite(report.netProfitYoy) && report.netProfitYoy < 0) risks.push(`累计归母净利润同比下降 ${Math.abs(report.netProfitYoy).toFixed(2)}%。`);
  if (finite(report.netProfit) && report.netProfit <= 0) risks.push("报告期归母净利润不为正，市盈率与现金含量指标需谨慎解释。");
  if (finite(report.operatingCashFlow) && report.operatingCashFlow < 0 && !financialInstitution) risks.push("经营活动现金流为负，需核查利润兑现与营运资金变化。");
  if (finite(cashToProfit) && cashToProfit < .7 && !financialInstitution) risks.push(`经营现金流 / 归母净利润仅 ${cashToProfit.toFixed(2)}，低于 0.7 的规则关注线。`);
  if (finite(report.debtRatio) && report.debtRatio > 70 && !financialInstitution) risks.push(`资产负债率 ${report.debtRatio.toFixed(2)}%，高于通用初筛关注线，需结合行业与有息负债复核。`);
  if (finite(report.deductedNetProfitYoy) && finite(report.netProfitYoy) && report.deductedNetProfitYoy < report.netProfitYoy - 10)
    risks.push("扣非净利润增速明显低于归母净利润增速，需核查非经常性损益影响。");

  const observations = [
    `本表 ${report.reportType || "定期报告"} 的收入、利润和现金流为年初至报告期累计值；单季度同比另行展示。`,
    `单季度营收同比 ${percent(report.quarterRevenueYoy)}，单季度归母净利润同比 ${percent(report.quarterNetProfitYoy)}。`,
    `报告期 ${report.reportDate}，公告日 ${report.noticeDate || "暂无"}；财报反映历史经营，不是实时业绩。`,
  ];
  if (financialInstitution) observations.push("识别为金融企业，现金流和资产负债率不按实体企业阈值评分；仍需补充行业专属监管与资产质量指标。");
  if (score === null) observations.push("可用指标权重不足 50%，不输出基本面分数或买卖候选。");
  return { report, score, coverage, rating, annualizedRoe, cashToProfit, financialInstitution, factors, strengths, risks, observations };
}

export function valuationObservations(quote: Quote | null) {
  if (!quote) return ["实时估值尚未取得。"];
  const lines = [`PE(TTM) ${finite(quote.pe) && quote.pe > 0 ? quote.pe.toFixed(2) : "不可用"}，PB ${finite(quote.pb) && quote.pb > 0 ? quote.pb.toFixed(2) : "不可用"}。`];
  lines.push("估值不参与上述通用分数：低 PE/PB 不必然低估，需与同行业、自身历史及盈利周期比较。行情估值与财报报告期口径不同。");
  return lines;
}

export function combineOperationAdvice(input: {
  fundamental: FundamentalAnalysis | null;
  quant: QuantAdviceInput | null;
  model?: ModelAdviceInput | null;
  quantity: number;
  quoteFresh: boolean;
}): CombinedAdvice {
  const { fundamental, quant, model, quantity } = input;
  const reasons: string[] = [];
  if (fundamental) reasons.push(`基本面 ${fundamental.score === null ? "数据不足" : `${fundamental.score} 分 / ${fundamental.rating}`}，指标覆盖 ${fundamental.coverage}%。`);
  if (quant?.ready) reasons.push(`量价模型：${quant.action ?? "未给出动作"}（截至 ${quant.date ?? "未知"}）。`);
  else if (quant) reasons.push(`量价模型不可用：${quant.reason ?? "数据不足"}`);
  if (model) reasons.push(`复盘策略：${model.summary}${model.asof ? `（${model.asof}）` : ""}`);
  if (!fundamental || fundamental.score === null) return { action: "数据不足", summary: "缺少足够的有效财报指标，不形成综合操作建议。", reasons };
  if (!input.quoteFresh) return { action: "观望", summary: "实时报价过旧或不可用，暂停形成操作候选。", reasons };
  if (!quant?.ready) return { action: "观望", summary: "量价条件无法验证，暂不依据财报分数单独交易。", reasons };
  if ((model?.action === "reduce" || quant.action === "减仓观察") && quantity > 0)
    return { action: "减仓复核", summary: "复盘策略或量价模型出现退出信号；已有仓位应优先复核原止损、可卖数量与减仓计划。", reasons };
  if (fundamental.score < 40 || (finite(fundamental.report.netProfit) && fundamental.report.netProfit <= 0))
    return { action: quantity > 0 ? "持有观察" : "观望", summary: "基本面规则提示明显风险，不生成新买入候选；已有仓位需人工复核风险，不自动给出卖出数量。", reasons };
  if (quantity === 0 && model?.action === "wait" && !/未覆盖/.test(model.summary))
    return { action: "观望", summary: "复盘模型未通过有效性或时效门槛，暂不生成新买入候选。", reasons };
  if (quantity === 0 && quant.action === "买入候选" && fundamental.score >= 60)
    return { action: "买入候选", summary: "基本面与量价规则同时达到候选门槛；这只是研究候选，仍须核对仓位上限、成本止损、公告和实际可成交价格。", reasons };
  if (quantity === 0 && finite(quant.bias) && quant.bias > 5)
    return { action: "暂缓追涨", summary: "价格相对 MA20 偏离超过 5%，即使财报较好也不追价。", reasons };
  return {
    action: quantity > 0 ? "持有观察" : "观望",
    summary: quantity > 0 ? "未出现需要优先处理的模型退出信号，也未确认新的加仓条件；继续跟踪财报风险和原交易计划。" : "财报与量价条件尚未同时满足新买入候选门槛，等待下一次确认。",
    reasons,
  };
}

export function buildFinancialContext(data: FinancialReports | null, analysis: FundamentalAnalysis | null) {
  if (!data || !analysis) return "";
  const lines = ["【定期报告与基本面规则分析】", `来源：${data.source}；抓取时间：${data.updatedAt}；原始公告入口：${data.reportUrl}`];
  lines.push("报告期\t类型\t公告日\t营收(元)\t归母净利润(元)\t经营现金流(元)\t营收同比%\t归母净利同比%\tROE%\t资产负债率%");
  for (const report of data.reports.slice(0, 8)) {
    lines.push([report.reportDate, report.reportType, report.noticeDate || "--", report.revenue, report.netProfit,
      report.operatingCashFlow, report.revenueYoy, report.netProfitYoy, report.roeWeighted, report.debtRatio]
      .map(value => value === null || value === undefined ? "--" : String(value)).join("\t"));
  }
  lines.push(`最新有效报告：${analysis.report.reportDateName || analysis.report.reportDate}；规则评分 ${analysis.score ?? "数据不足"}/100，指标覆盖 ${analysis.coverage}%。`);
  lines.push(`优势：${analysis.strengths.join("；") || "未达到规则优势阈值"}`);
  lines.push(`风险：${analysis.risks.join("；") || "未触发通用规则风险阈值，不代表没有风险"}`);
  lines.push(...analysis.observations);
  lines.push("评分是应用的通用初筛规则，不是上涨概率或买卖评级；报告期累计值不能当成单季度值。请结合最新公告、行业特点和上述行情数据，不得编造缺失指标。");
  return lines.join("\n");
}
