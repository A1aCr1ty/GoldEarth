import { invoke, isTauri } from "@tauri-apps/api/core";

export interface NbaTeam {
  id: string; abbreviation: string; displayName: string; logo?: string; color?: string;
}
export interface NbaCompetitor {
  homeAway: string; team: NbaTeam; score?: string;
  linescores?: { value: number; displayValue?: string }[];
}
export interface NbaStatus {
  displayClock?: string; period?: number;
  type: { state: string; name?: string; completed?: boolean; shortDetail?: string; description?: string };
}
export interface NbaEvent {
  id: string; date: string; name: string; status: NbaStatus;
  competitions: { competitors: NbaCompetitor[]; venue?: { fullName: string }; status?: NbaStatus }[];
}
export interface NbaScoreboard { events: NbaEvent[] }
export interface NbaSummary {
  boxscore?: {
    teams?: { team: NbaTeam; statistics?: { name: string; label: string; displayValue: string }[] }[];
    players?: { team: NbaTeam; statistics?: {
      labels: string[]; athletes: { athlete: { id: string; displayName: string; jersey?: string }; starter?: boolean; didNotPlay?: boolean; stats: string[] }[];
    }[] }[];
  };
}

export const TEAM_NAMES: Record<string, string> = {
  ATL: "老鹰", BOS: "凯尔特人", BKN: "篮网", BRK: "篮网", CHA: "黄蜂", CHI: "公牛",
  CLE: "骑士", DAL: "独行侠", DEN: "掘金", DET: "活塞", GS: "勇士", GSW: "勇士",
  HOU: "火箭", IND: "步行者", LAC: "快船", LAL: "湖人", MEM: "灰熊", MIA: "热火",
  MIL: "雄鹿", MIN: "森林狼", NO: "鹈鹕", NOP: "鹈鹕", NY: "尼克斯", NYK: "尼克斯",
  OKC: "雷霆", ORL: "魔术", PHI: "76人", PHX: "太阳", POR: "开拓者", SAC: "国王",
  SA: "马刺", SAS: "马刺", TOR: "猛龙", UTAH: "爵士", UTA: "爵士", WSH: "奇才", WAS: "奇才",
};
export const teamName = (team: NbaTeam) => TEAM_NAMES[team.abbreviation] || team.displayName;
export function beijingDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(type => parts.find(p => p.type === type)?.value).join("-");
}
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setTime(value.getTime() + days * 86400000);
  return beijingDate(value);
}
export function gamesForDate(data: NbaScoreboard, date: string): NbaEvent[] {
  if (!data || !Array.isArray(data.events)) throw new Error("NBA 赛程响应不完整，请稍后重试");
  if (data.events.some(e => !e || !e.id || !e.status?.type || typeof e.status.type.state !== "string" ||
    !Number.isFinite(Date.parse(e.date)) || e.competitions?.[0]?.competitors?.length !== 2 ||
    e.competitions[0].competitors.some(c => !c?.team || typeof c.team.id !== "string" || typeof c.team.abbreviation !== "string" || typeof c.team.displayName !== "string"))) {
    throw new Error("NBA 赛程响应不完整，请稍后重试");
  }
  return [...new Map(data.events.filter(e => e.id && e.competitions?.[0]?.competitors?.length === 2 && Number.isFinite(Date.parse(e.date)) && beijingDate(new Date(e.date)) === date).map(e => [e.id, e])).values()]
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}
export function statusText(status: NbaStatus): string {
  if (status.type.completed) return "已结束";
  if (status.type.name === "STATUS_POSTPONED") return "已延期";
  if (status.type.name === "STATUS_CANCELED") return "已取消";
  if (status.type.name === "STATUS_HALFTIME") return "中场休息";
  if (status.type.state === "in") return `${(status.period || 0) > 4 ? `加时 ${(status.period || 5) - 4}` : `第 ${status.period || 1} 节`} · ${status.displayClock || "进行中"}`;
  if (status.type.state === "pre") return "未开始";
  return status.type.shortDetail || status.type.description || "待更新";
}
const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const pending = new Map<string, Promise<unknown>>();
const cache = new Map<string, { data: unknown; updated: number }>();
export function nbaSnapshot<T>(key: string): { data: T; updated: number } | undefined {
  return cache.get(key) as { data: T; updated: number } | undefined;
}
function request<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const task = Promise.resolve().then(fetcher).then(data => {
    cache.delete(key);
    cache.set(key, { data, updated: Date.now() });
    if (cache.size > 32) cache.delete(cache.keys().next().value!);
    return data;
  }).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

// Schedule from completion so slow requests never pile up; recover on visibility/network changes.
export function pollNba(update: () => Promise<void>, auto: boolean): () => void {
  let disposed = false, busy = false, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (disposed || busy || document.visibilityState === "hidden") return;
    clearTimeout(timer);
    busy = true;
    try { await update(); failures = 0; }
    catch { failures = Math.min(failures + 1, 3); }
    finally {
      busy = false;
      if (!disposed && auto) timer = setTimeout(() => void run(), Math.min(15000 * 2 ** failures, 120000));
    }
  };
  const resume = () => { if (auto) void run(); };
  void run();
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("online", resume);
  return () => { disposed = true; clearTimeout(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
}
async function publicFetch<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`NBA 数据服务暂不可用（${response.status}）`);
  return response.json();
}
export async function loadScoreboard(date: string): Promise<NbaEvent[]> {
  return request(`scoreboard:${date}`, async () => {
  if (isTauri()) return gamesForDate(await invoke<NbaScoreboard>("nba_scoreboard", { date }), date);
  const responses = await Promise.all([shiftDate(date, -1), date].map(day => publicFetch<NbaScoreboard>(`${BASE}/scoreboard?dates=${day.replace(/-/g, "")}&limit=100`)));
  if (responses.some(r => !Array.isArray(r.events))) throw new Error("NBA 赛程响应不完整");
  return gamesForDate({ events: responses.flatMap(r => r.events) }, date);
  });
}
export async function loadSummary(eventId: string): Promise<NbaSummary> {
  return request(`summary:${eventId}`, async () => {
  const result = isTauri() ? await invoke<NbaSummary>("nba_summary", { eventId }) : await publicFetch<NbaSummary>(`${BASE}/summary?event=${eventId}`);
  if (!result || typeof result !== "object" || Array.isArray(result) || !("boxscore" in result || "header" in result)) throw new Error("NBA 技术统计响应不完整");
  const box = result.boxscore;
  const validTeam = (t: NbaTeam) => t && typeof t.id === "string" && typeof t.abbreviation === "string" && typeof t.displayName === "string";
  const validTeams = box?.teams === undefined || (Array.isArray(box.teams) && box.teams.every(t =>
    validTeam(t?.team) && (t.statistics === undefined || (Array.isArray(t.statistics) && t.statistics.every(s =>
      s && typeof s.name === "string" && typeof s.label === "string" && typeof s.displayValue === "string")))));
  const validPlayers = box?.players === undefined || (Array.isArray(box.players) && box.players.every(t =>
    validTeam(t?.team) && (t.statistics === undefined || (Array.isArray(t.statistics) && t.statistics.every(g =>
      g && Array.isArray(g.labels) && g.labels.every(label => typeof label === "string") &&
      Array.isArray(g.athletes) && g.athletes.every(p => p?.athlete && typeof p.athlete.id === "string" &&
        typeof p.athlete.displayName === "string" && Array.isArray(p.stats) && p.stats.every(s => typeof s === "string")))))));
  if (!validTeams || !validPlayers) {
    throw new Error("NBA 技术统计响应不完整");
  }
  return result;
  });
}
