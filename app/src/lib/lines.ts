/**
 * 天气页的「文字推送」：一句短句，跟着季节、天气和早晚走。
 *
 * 这里只放古典诗词（唐宋诗经那一档），原因有两个：一是公有领域，随手引用没有负担；
 * 二是这类句子短、有画面，配在大字号衬线下最像样。不要往这里塞无从考证的网络金句。
 *
 * 选句是纯函数：同一个上下文和步数永远得到同一句，所以刷新页面不会乱跳，
 * 换天、换时段、换天气才换一批。点「换一句」就是 step + 1。
 */

/** 句子适合的场景；any 表示什么场合都能用 */
export type LineTag = "spring" | "summer" | "autumn" | "winter" | "rain" | "snow" | "sun" | "night" | "dawn" | "any";

export interface PushLine {
  text: string;
  /** 出处，直接跟「—— 」拼在一起显示，例如「苏轼《定风波》」 */
  from: string;
  tags: LineTag[];
}

export interface LineContext {
  /** 上下文指纹：日期或时段一变，界面就把 step 归零重来 */
  seed: string;
  /** 命中的场景标签（含 any），用来挑句子 */
  keys: LineTag[];
  /** 给界面显示的短标签，例如「秋 · 晴」 */
  label: string;
}

export const PUSH_LINES: PushLine[] = [
  // —— 春 ——
  { text: "日出江花红胜火，春来江水绿如蓝。", from: "白居易《忆江南》", tags: ["spring", "sun"] },
  { text: "竹外桃花三两枝，春江水暖鸭先知。", from: "苏轼《惠崇春江晚景》", tags: ["spring", "sun"] },
  { text: "等闲识得东风面，万紫千红总是春。", from: "朱熹《春日》", tags: ["spring"] },
  { text: "沾衣欲湿杏花雨，吹面不寒杨柳风。", from: "志南《绝句》", tags: ["spring", "rain"] },
  { text: "草长莺飞二月天，拂堤杨柳醉春烟。", from: "高鼎《村居》", tags: ["spring"] },
  { text: "燕子来时新社，梨花落后清明。", from: "晏殊《破阵子》", tags: ["spring"] },
  { text: "绿杨烟外晓寒轻，红杏枝头春意闹。", from: "宋祁《玉楼春》", tags: ["spring", "dawn"] },
  { text: "桃之夭夭，灼灼其华。", from: "《诗经·周南·桃夭》", tags: ["spring"] },
  { text: "知否知否，应是绿肥红瘦。", from: "李清照《如梦令》", tags: ["spring", "rain"] },
  { text: "小楼一夜听春雨，深巷明朝卖杏花。", from: "陆游《临安春雨初霁》", tags: ["spring", "rain", "dawn"] },
  { text: "且将新火试新茶，诗酒趁年华。", from: "苏轼《望江南》", tags: ["spring", "any"] },
  { text: "只恐夜深花睡去，故烧高烛照红妆。", from: "苏轼《海棠》", tags: ["spring", "night"] },

  // —— 夏 ——
  { text: "接天莲叶无穷碧，映日荷花别样红。", from: "杨万里《晓出净慈寺送林子方》", tags: ["summer", "sun"] },
  { text: "水晶帘动微风起，满架蔷薇一院香。", from: "高骈《山亭夏日》", tags: ["summer"] },
  { text: "稻花香里说丰年，听取蛙声一片。", from: "辛弃疾《西江月》", tags: ["summer", "night"] },
  { text: "明月别枝惊鹊，清风半夜鸣蝉。", from: "辛弃疾《西江月》", tags: ["summer", "night"] },
  { text: "南风知我意，吹梦到西洲。", from: "《西洲曲》", tags: ["summer", "night", "any"] },
  { text: "日长睡起无情思，闲看儿童捉柳花。", from: "杨万里《闲居初夏午睡起》", tags: ["summer"] },
  { text: "黑云翻墨未遮山，白雨跳珠乱入船。", from: "苏轼《六月二十七日望湖楼醉书》", tags: ["summer", "rain"] },

  // —— 秋 ——
  { text: "落霞与孤鹜齐飞，秋水共长天一色。", from: "王勃《滕王阁序》", tags: ["autumn", "sun"] },
  { text: "明月松间照，清泉石上流。", from: "王维《山居秋暝》", tags: ["autumn", "night"] },
  { text: "空山新雨后，天气晚来秋。", from: "王维《山居秋暝》", tags: ["autumn", "rain"] },
  { text: "一年好景君须记，最是橙黄橘绿时。", from: "苏轼《赠刘景文》", tags: ["autumn"] },
  { text: "停车坐爱枫林晚，霜叶红于二月花。", from: "杜牧《山行》", tags: ["autumn"] },
  { text: "晴空一鹤排云上，便引诗情到碧霄。", from: "刘禹锡《秋词》", tags: ["autumn", "sun"] },
  { text: "人生若只如初见，何事秋风悲画扇。", from: "纳兰性德《木兰花》", tags: ["autumn", "any"] },
  { text: "莫道不销魂，帘卷西风，人比黄花瘦。", from: "李清照《醉花阴》", tags: ["autumn"] },

  // —— 冬 · 雪 ——
  { text: "忽如一夜春风来，千树万树梨花开。", from: "岑参《白雪歌送武判官归京》", tags: ["winter", "snow"] },
  { text: "晚来天欲雪，能饮一杯无。", from: "白居易《问刘十九》", tags: ["winter", "snow", "night"] },
  { text: "绿蚁新醅酒，红泥小火炉。", from: "白居易《问刘十九》", tags: ["winter", "night"] },
  { text: "孤舟蓑笠翁，独钓寒江雪。", from: "柳宗元《江雪》", tags: ["winter", "snow"] },
  { text: "夜深知雪重，时闻折竹声。", from: "白居易《夜雪》", tags: ["winter", "snow", "night"] },
  { text: "遥知不是雪，为有暗香来。", from: "王安石《梅花》", tags: ["winter", "snow"] },

  // —— 雨 ——
  { text: "好雨知时节，当春乃发生。", from: "杜甫《春夜喜雨》", tags: ["rain", "spring"] },
  { text: "天街小雨润如酥，草色遥看近却无。", from: "韩愈《早春呈水部张十八员外》", tags: ["rain", "spring"] },
  { text: "竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。", from: "苏轼《定风波》", tags: ["rain", "any"] },
  { text: "莫听穿林打叶声，何妨吟啸且徐行。", from: "苏轼《定风波》", tags: ["rain"] },
  { text: "何当共剪西窗烛，却话巴山夜雨时。", from: "李商隐《夜雨寄北》", tags: ["rain", "night"] },
  { text: "春潮带雨晚来急，野渡无人舟自横。", from: "韦应物《滁州西涧》", tags: ["rain"] },
  { text: "小雨纤纤风细细，万家杨柳青烟里。", from: "朱服《渔家傲》", tags: ["rain", "spring"] },

  // —— 晴 ——
  { text: "水光潋滟晴方好，山色空蒙雨亦奇。", from: "苏轼《饮湖上初晴后雨》", tags: ["sun", "rain"] },
  { text: "两个黄鹂鸣翠柳，一行白鹭上青天。", from: "杜甫《绝句》", tags: ["sun", "spring"] },
  { text: "不畏浮云遮望眼，自缘身在最高层。", from: "王安石《登飞来峰》", tags: ["sun", "any"] },
  { text: "会当凌绝顶，一览众山小。", from: "杜甫《望岳》", tags: ["sun", "any"] },

  // —— 夜 ——
  { text: "床前明月光，疑是地上霜。", from: "李白《静夜思》", tags: ["night"] },
  { text: "举头望明月，低头思故乡。", from: "李白《静夜思》", tags: ["night"] },
  { text: "星垂平野阔，月涌大江流。", from: "杜甫《旅夜书怀》", tags: ["night"] },
  { text: "野旷天低树，江清月近人。", from: "孟浩然《宿建德江》", tags: ["night"] },
  { text: "月落乌啼霜满天，江枫渔火对愁眠。", from: "张继《枫桥夜泊》", tags: ["night", "autumn"] },
  { text: "天阶夜色凉如水，卧看牵牛织女星。", from: "杜牧《秋夕》", tags: ["night", "autumn"] },
  { text: "醉后不知天在水，满船清梦压星河。", from: "唐温如《题龙阳县青草湖》", tags: ["night"] },
  { text: "海上生明月，天涯共此时。", from: "张九龄《望月怀远》", tags: ["night", "any"] },
  { text: "蓦然回首，那人却在，灯火阑珊处。", from: "辛弃疾《青玉案·元夕》", tags: ["night"] },
  { text: "月上柳梢头，人约黄昏后。", from: "欧阳修《生查子》", tags: ["night", "any"] },

  // —— 晨 ——
  { text: "晨兴理荒秽，带月荷锄归。", from: "陶渊明《归园田居》", tags: ["dawn"] },
  { text: "春眠不觉晓，处处闻啼鸟。", from: "孟浩然《春晓》", tags: ["dawn", "spring"] },
  { text: "天接云涛连晓雾，星河欲转千帆舞。", from: "李清照《渔家傲》", tags: ["dawn", "night"] },

  // —— 什么时候都行 ——
  { text: "长风破浪会有时，直挂云帆济沧海。", from: "李白《行路难》", tags: ["any"] },
  { text: "行到水穷处，坐看云起时。", from: "王维《终南别业》", tags: ["any"] },
  { text: "此心安处是吾乡。", from: "苏轼《定风波》", tags: ["any"] },
  { text: "人间有味是清欢。", from: "苏轼《浣溪沙》", tags: ["any"] },
  { text: "山有木兮木有枝，心悦君兮君不知。", from: "《越人歌》", tags: ["any"] },
  { text: "所谓伊人，在水一方。", from: "《诗经·秦风·蒹葭》", tags: ["any"] },
  { text: "青青子衿，悠悠我心。", from: "《诗经·郑风·子衿》", tags: ["any"] },
  { text: "我见青山多妩媚，料青山见我应如是。", from: "辛弃疾《贺新郎》", tags: ["any"] },
  { text: "何须浅碧深红色，自是花中第一流。", from: "李清照《鹧鸪天》", tags: ["any"] },
  { text: "当时只道是寻常。", from: "纳兰性德《浣溪沙》", tags: ["any"] },
  { text: "身无彩凤双飞翼，心有灵犀一点通。", from: "李商隐《无题》", tags: ["any"] },
  { text: "此时情绪此时天，无事小神仙。", from: "周邦彦《鹤冲天》", tags: ["any"] },
];

/** 标签 → 界面上那个小角标用的字 */
const TAG_LABELS: Record<LineTag, string> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
  rain: "雨",
  snow: "雪",
  sun: "晴",
  night: "夜",
  dawn: "晨",
  any: "",
};

const ALL_TAGS = Object.keys(TAG_LABELS) as LineTag[];

/** 雨类天气代码（WMO）：毛毛雨、雨、阵雨、雷雨都算 */
function isRainCode(code: number): boolean {
  return (code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

/** 雪类天气代码 */
function isSnowCode(code: number): boolean {
  return (code >= 71 && code <= 77) || code === 85 || code === 86;
}

/** 月份 → 季节 */
export function seasonOf(date: string): LineTag {
  const month = Number(date.slice(5, 7));
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

/**
 * 由日期、时刻和天气算出这次该用哪些场景。
 * 早晚只在「看今天」时才算：翻到日历里的别的日子，用户关心的是那天本身，不是此刻几点钟。
 */
export function lineContext(input: {
  date: string;
  hour: number;
  /** 那天的天气代码；拿不到就传 null */
  code: number | null;
  isDay: boolean;
  /** 选中的是不是今天 */
  isToday: boolean;
}): LineContext {
  const keys: LineTag[] = [seasonOf(input.date)];
  if (input.code !== null) {
    if (isRainCode(input.code)) keys.push("rain");
    else if (isSnowCode(input.code)) keys.push("snow");
    else if (input.code <= 2 && input.isDay) keys.push("sun");
  }
  if (input.isToday) {
    if (input.hour >= 19 || input.hour < 5) keys.push("night");
    else if (input.hour >= 5 && input.hour < 8) keys.push("dawn");
  }
  // any 永远在池子里：通用句什么时候都不突兀，也保证池子不会太小
  keys.push("any");
  const label = keys
    .map((key) => TAG_LABELS[key])
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
  // 白天每三小时一段，翻到别的日期就整天用同一段
  const slot = input.isToday ? `h${Math.floor(input.hour / 3)}` : "day";
  return { seed: `${input.date}#${slot}`, keys, label };
}

/** FNV-1a：给「稳定打乱」用，同一串输入永远同一个数 */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** 命中场景的那些句子；顺序固定，方便测试对着看 */
export function poolFor(context: LineContext): PushLine[] {
  return PUSH_LINES.filter((line) => line.tags.some((tag) => context.keys.includes(tag)));
}

/**
 * 取第 step 句。池子按 seed 做一次稳定打乱，所以同一天同一时段的顺序是固定的：
 * step 0 就是「进入页面时看到的那句」，点「换一句」往前走，走完一轮再回到开头。
 */
export function pickPushLine(context: LineContext, step: number): PushLine {
  const pool = poolFor(context);
  if (pool.length === 0) return PUSH_LINES[0];
  const ordered = [...pool].sort((a, b) => {
    const diff = hash(`${context.seed}|${a.text}`) - hash(`${context.seed}|${b.text}`);
    return diff !== 0 ? diff : a.text.localeCompare(b.text);
  });
  const index = ((step % ordered.length) + ordered.length) % ordered.length;
  return ordered[index];
}

export { ALL_TAGS, TAG_LABELS };
