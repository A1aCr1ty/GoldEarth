/** 首页与日历用到的日期工具，全部按本地时区计算。 */

/** 周一开头，和国内日历习惯一致 */
export const WEEKDAY_NAMES = ["一", "二", "三", "四", "五", "六", "日"] as const;

const FULL_WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const;

/** Date → YYYY-MM-DD */
export function ymd(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** YYYY-MM-DD → 本地零点 */
export function parseYmd(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function weekdayLabel(date: Date): string {
  return FULL_WEEKDAYS[date.getDay()];
}

/** 例如 2026 年 10 月 */
export function monthLabel(date: Date): string {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 今天是今年的第几天 */
export function dayOfYear(date: Date): number {
  const first = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date.getTime() - first.getTime()) / 86400000) + 1;
}

/** ISO 周号（周一为一周之始，由本周周四所在的周决定） */
export function isoWeek(date: Date): number {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

/** 相对今天的说法：今天 / 明天 / 昨天 / 3 天后 / 3 天前 */
export function relativeToToday(date: Date, today: Date): string {
  const diff = Math.round((date.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === -1) return "昨天";
  return diff > 0 ? `${diff} 天后` : `${-diff} 天前`;
}

/** 日历网格：从光标月份的周一那一列开始，铺满 6 周 42 格 */
export function monthGrid(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  // getDay() 里 0 是周日，换成周一开头的偏移
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** HH:MM:SS */
export function clockText(date: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 时间戳 → HH:MM。带时区的（后端用 UTC 写的）会转成本地时间，否则按字面取。 */
export function timeOf(stamp: string): string {
  const match = stamp.match(/T(\d{2}:\d{2})/);
  const zoned = /([zZ]|[+-]\d{2}:\d{2})$/.test(stamp);
  if (!zoned && match) return match[1];
  const date = new Date(stamp);
  if (!Number.isNaN(date.getTime())) return clockText(date).slice(0, 5);
  return match ? match[1] : stamp;
}