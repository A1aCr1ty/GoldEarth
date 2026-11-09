import type { FundamentalAnalysis } from './fundamental';

export const institutionalSources = [
  { institution: '中信证券研究', title: '官方研究入口', published: null, reviewed: '2026-11-08', access: '公开摘要 / 部分全文需登录',
    url: 'https://research.citics.com/', lesson: '跟踪产业景气与业绩兑现，区分产业趋势和估值、流动性风险。', kind: '研究入口，非已取得个股研报全文' },
  { institution: '中金公司', title: '中金研究与中金点睛', published: null, reviewed: '2026-11-08', access: '公开平台介绍 / 报告可能需权限',
    url: 'https://www.ciccwm.com/ciccwmweb/stock_business/equity_research.html', lesson: '建立宏观、策略、行业、公司分层研究资料目录。', kind: '平台介绍，非报告观点' },
  { institution: '华泰证券', title: 'CAMS信用研究方法介绍', published: null, reviewed: '2026-11-08', access: '公开方法介绍',
    url: 'https://clients.htsc.com/intro/research', lesson: '主体、行业与区域分层核查，并用市场定价检验基本面判断。信用研究方法不直接等同于股票收益模型。', kind: '方法资料' },
  { institution: '招商证券国际', title: '公司、行业与策略研报目录', published: null, reviewed: '2026-11-08', access: '公开标题、作者、日期 / 全文需权限',
    url: 'https://www.cmschina.com.hk/en/Research/HK-Research', lesson: '按公司、行业、策略区分报告；记录作者、发布日期、评级变化和业绩预期差。目录标题不足以推断完整论证。', kind: '研究入口，含非A股公司' },
  { institution: 'Goldman Sachs', title: '2025 Outlook: The Year of the Alpha Bet（公开删节版）', published: '2024-11-18', reviewed: '2026-11-08', access: '公开PDF已核验',
    url: 'https://www.goldmansachs.com/pdfs/insights/goldman-sachs-research/2025-equity-outlook-the-year-of-the-alpha-bet/2025Outlook.pdf', lesson: '拆解盈利增长与估值倍数变化；结合历史分位与多种估值指标，审视集中度和分散化。该报告是历史方法样例，不代表当前市场观点。', kind: '策略报告，非A股个股评级' },
  { institution: 'J.P. Morgan', title: 'Mid-year market outlook 2026', published: '2026-07-01', reviewed: '2026-11-08', access: '公开搜索摘要，原站访问受限',
    url: 'https://www.jpmorgan.com/insights/global-research/outlook/mid-year-outlook', lesson: '将资本开支、盈利修正、利率和估值约束联系起来；全文未核验，不将摘要当作完整研报。', kind: '策略摘要' },
];

export function researchChecklist(a: FundamentalAnalysis) {
  const r = a.report;
  const number = (n: number | null, suffix = '%') => n !== null && Number.isFinite(n) ? `${n.toFixed(2)}${suffix}` : '缺失';
  return [
    { title: '经营与竞争格局', evidence: '待补：分业务收入、销量、单价、市场份额、主要客户与竞争对手。', next: '把收入变化拆成销量、价格与业务结构；每项判断引用公司公告或可核验行业数据。' },
    { title: '增长质量与预期差', evidence: `已取财报：累计营收同比 ${number(r.revenueYoy)}；单季同比 ${number(r.quarterRevenueYoy)}；扣非净利同比 ${number(r.deductedNetProfitYoy)}。`, next: '比较同口径历史、管理层指引及发布当时的机构预测；没有历史预测快照时不声称“超预期”。' },
    { title: '盈利与现金流', evidence: `已取财报：毛利率 ${number(r.grossMargin)}；净利率 ${number(r.netMargin)}；经营现金流/归母净利 ${number(a.cashToProfit, '倍')}。`, next: a.financialInstitution ? '金融行业改查净息差、不良贷款、拨备或保险负债等专用指标；通用现金流比率不作质量结论。' : '补充应收、存货、预收、资本开支与非经常损益，核查利润和现金为何不同步。' },
    { title: '资产负债与资本配置', evidence: `已取财报：资产负债率 ${number(r.debtRatio)}；加权ROE ${number(r.roeWeighted)}（报告期口径）。`, next: '补充债务期限、利息费用、担保、商誉减值、分红与回购；金融企业用行业专用资本要求。' },
    { title: '估值与三种情景', evidence: '待补：一致口径同行估值、历史估值分位、未来盈利假设和资本成本。', next: '分别列悲观、基准、乐观的销量/价格/利润率假设及敏感性；选择适用的PE、PB、DCF或剩余收益法。参数不足不编目标价。' },
    { title: '催化剂、反证与跟踪', evidence: '待补：带日期的订单、产能、产品、政策、业绩发布和机构预测版本。', next: '每个投资论点给出可观察的验证指标、失效条件与复核日期；技术指标辅助择时，不能替代长期价值判断。' },
  ];
}

export function institutionalContext() {
  return ['【机构研究方法：用于组织分析，不是机构对当前股票的推荐】',
    '研究周期为A股3至12个月。依次分析：商业模式与竞争格局、盈利驱动与预期差、现金流质量、资本配置、估值三情景、催化剂与反证。',
    '将结论逐项标成财报事实、机构观点、模型估计或待核验假设。引用机构观点须有机构、作者、报告标题、发布日期、原文链接、涉及证券和页码；资料没有的字段标缺失。',
    '优先使用机构官方公开报告。目录、搜索摘要、转载与全文的证据等级不同，不得声称读过未取得的全文，不绕过登录或付费权限。',
    '对各机构相反观点分别展示其前提；评级、目标价和盈利预测不得充当正确答案。历史回测只能使用信号时点之前发布且版本可核验的材料。',
    '未取得业务分部、同行或未来盈利参数时，给出需补数据和条件情景，不编造目标价、市场份额、一致预期或机构观点。',
    '投资收益评估须扣除交易成本和AI费用，不能保证每月盈利；用户资金和费用未知时不得假设已能覆盖。',
    ...institutionalSources.map(s => `${s.institution} | ${s.title} | ${s.published || '动态入口，无固定发布日期'} | ${s.access} | ${s.url}\n方法笔记：${s.lesson}`),
  ].join('\n');
}
