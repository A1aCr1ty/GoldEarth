import { evaluateQuant } from "./stockQuant";

export const RESEARCH = [
  { date:"2026-06-14", title:"五日战法详细版", file:"D:/css/6月文章/6月14日【星球专供】私募一哥常士杉五日战法详细版.pdf", pages:"2–4", kind:"method", summary:"站上MA5、三天量能、七天巨量；收盘低于MA5×92.5%减半。量能活跃未明确定义；应用采用连续三日逐日增量，巨量按前日成交量1.45倍解释。" },
  { date:"2026-08-09", title:"20%强止损的五大由来", file:"D:/css/8月文章/八月往期/为什么在全球资本市场必须坚决执行20%强止损？—20%强止损的五大由来（2026年8月9日）.pdf", pages:"1、3", kind:"method", summary:"20%是风险警报，不是普遍机械阈值；需结合逻辑、趋势、资金及基本面，先设计风险预算，避免无限补仓。" },
  { date:"2026-10-11", title:"周报及下周策略", file:"D:/css/10.11周报及下周重要‼️策略.pdf", pages:"1", kind:"weekly", summary:"当周反弹场景：总仓上限55%、单票15%、新短线15%止损；不能作为永久默认仓位。" },
  { date:"2026-10-13", title:"10.12直播复盘", file:"D:/css/10.13.pdf", pages:"1", kind:"daily", summary:"当时底部构建观点附带海外市场前提，半仓与确认后加仓属于情景判断。" },
  { date:"2026-10-16", title:"10.15直播复盘", file:"D:/css/10.16.pdf", pages:"1", kind:"daily", summary:"当时短线反抽场景提及A股六至七成、反抽后降至半仓及25%止损；不覆盖10.11不同场景，更不直接沿用至今天。" },
];
export function researchState(date:string, kind:string, today:string) {
  const age=(Date.parse(today)-Date.parse(date))/86400000;
  if (!Number.isFinite(age)||age<0) return "日期待核实";
  if(kind==="method") return "方法参考 · 需重新验证";
  return age > (kind==="daily"?1:7) ? "已过期 · 仅历史佐证" : "情景参考 · 仍需核对前提";
}

type Quant = ReturnType<typeof evaluateQuant>;
export function tradePlan(q:Quant|null, price:number, cost:number, options:{ total:number; stock:number; cap:number; totalCap:number; risk:number; stop:number; verified:boolean; quoteFresh:boolean }) {
  const blocked=(reason:string)=>({action:"暂不交易", steps:[reason], allowance:0, stopPrice:null as number|null});
  if(!q?.ready || !options.quoteFresh || !Number.isFinite(price)||price<=0) return blocked("行情不足或报价不新鲜：刷新后再生成操作方案。");
  const {total,stock,cap,totalCap,risk,stop}=options;
  if(![total,stock,cap,totalCap,risk,stop].every(Number.isFinite)||stock<0||total<stock||total>100||cap<=0||cap>100||totalCap<=0||totalCap>100||risk<=0||risk>100||stop<=0||stop>=100) return blocked("请核对仓位与风险预算：单票仓位不能大于总仓位，止损幅度须在0%到100%之间。");
  const hasCost=Number.isFinite(cost)&&cost>0;
  const stopPrice=hasCost?cost*(1-stop/100):null;
  const allowance=Math.max(0,Math.min(cap-stock,totalCap-total,risk/(stop/100)-stock));
  if(stock>0 && stopPrice!==null && price<=stopPrice) return {action:"卖出：止损优先",steps:[`报价已触及自定成本止损线 ${stopPrice.toFixed(2)} 元，优先退出可卖仓位，取消加仓。`,`若停牌、跌停或受T+1限制，记录未成交风险；触发价不保证成交。`],allowance:0,stopPrice};
  if(stock>cap||total>totalCap||stock*stop/100>risk) return {action:"卖出：降低超限仓位",steps:[`本票至少减 ${Math.max(0,stock-Math.min(cap,risk/(stop/100))).toFixed(2)} 个账户百分点（仓位/风险预算约束）；组合总仓至少降 ${Math.max(0,total-totalCap).toFixed(2)} 个百分点，组合减仓不应全部归于本票。`],allowance:0,stopPrice};
  if(stock>0 && q.fiveExit) return {action:"卖出：五日线纪律",steps:["历史收盘已低于MA5的92.5%，参考减去当前可卖仓位的一半；结合已执行记录避免重复。","此为前复权日K信号，不把均线值直接当作未复权委托价。"],allowance:0,stopPrice};
  if(stock>0 && !hasCost) return blocked("已有仓位但缺少有效成本，无法核对止损与止盈；请填写实际持仓成本，暂停加仓。");
  if(stock>0 && hasCost && price>=cost*1.1) return {action:"卖出 / 持有：核对止盈阶段",steps:["已盈利至少10%，优先查看下方3221阶段；按你已完成的减仓记录处理，暂不新增买入。"],allowance:0,stopPrice};
  if(!options.verified) return blocked("尚未核对最新财报、重大公告与行业逻辑；技术条件不能代替基本面审核，暂不新买。已有仓位继续执行止损、减仓纪律。");
  if(q.fiveEntry && q.bias<=5 && q.bias>=0 && allowance>0 && !(stock>0&&hasCost&&price<cost)) return {action:"买入：分批试仓",steps:[`新增仓位上限 ${allowance.toFixed(2)} 个账户百分点；首次最多使用该额度的三分之一（${(allowance/3).toFixed(2)} 个百分点）。这是应用执行模板，不是原文仓位公式。`,`下个交易日重新核对价格不追高及量能持续；其余两批仅在后续日线继续满足条件且持仓盈利时考虑，重新计算额度。`,`计划止损幅度 ${stop}%（用户自定），以实际成交均价计算；未成交或跳空后须重算，禁止亏损摊平。`],allowance,stopPrice};
  return {action:stock>0?"持有观察，暂不加仓":"等待，不买入",steps:["未同时满足五日入场、MA20偏离0%～5%和仓位额度条件，或当前持仓浮亏。","继续跟踪收盘与量能；触发止损或减仓条件后优先执行卖出方案。"],allowance:0,stopPrice};
}
