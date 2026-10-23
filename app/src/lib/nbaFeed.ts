import { invoke } from "@tauri-apps/api/core";
import catalog from "./nba-teams.json";

export const NBA_TEAMS = catalog;
export const nbaTeamLabel = (id: string) => NBA_TEAMS.find(t => t.id === id)?.name || id;
export interface NbaFeedItem {
  title: string; url: string; summary: string; teams: string[]; kind: "news" | "post";
  source: string; publishedAt: string | null; timeLabel: string; author: string;
  replies: number | null; views: number | null;
}
export interface NbaFeedSource {
  id: string; name: string; url: string; kind: string; team: string | null;
  checkedAt: string; fetchedAt: string | null; error: string | null; items: NbaFeedItem[];
}
export interface NbaFeedReport { sources: NbaFeedSource[]; warning: string | null }
export interface NbaFeedPreferences { followed: string[]; auto: boolean; includeLeague: boolean }
export const NBA_FEED_KEY = "goldearth.nba.feed.preferences";
export function readNbaFeedPreferences(storage: Pick<Storage, "getItem">): NbaFeedPreferences {
  try {
    const value = JSON.parse(storage.getItem(NBA_FEED_KEY) || "null");
    return { followed: Array.isArray(value?.followed) ? [...new Set<string>(value.followed.filter((id: unknown) => typeof id === "string" && NBA_TEAMS.some(t => t.id === id)))] : [], auto: value?.auto !== false, includeLeague: value?.includeLeague === true };
  } catch { return { followed: [], auto: true, includeLeague: false }; }
}
const pending = new Map<string, Promise<NbaFeedReport>>();
export function loadNbaFeed(followed: string[], force = false): Promise<NbaFeedReport> {
  const teams = [...new Set(followed)].sort();
  const key = JSON.stringify([teams, force]);
  const existing = pending.get(key); if (existing) return existing;
  const task = Promise.resolve().then(() => invoke<NbaFeedReport>("nba_feed", { teamIds: teams, force })).finally(() => pending.delete(key));
  pending.set(key, task); return task;
}
export function filterNbaFeed(report: NbaFeedReport | null, options: {
  followed: string[]; team: string; kind: "news" | "post"; query: string; includeLeague: boolean; source: string;
}): { item: NbaFeedItem; status: NbaFeedSource }[] {
  const words = options.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  return (report?.sources || []).filter(s => s.kind === options.kind && (options.source === "all" || s.id === options.source))
    .flatMap(status => status.items.map(item => ({ item, status }))).filter(({ item }) => {
      if (options.team !== "all" && !item.teams.includes(options.team)) return false;
      if (options.followed.length) {
        if (!item.teams.some(id => options.followed.includes(id)) && !(options.kind === "news" && !item.teams.length && options.includeLeague && options.team === "all")) return false;
      } else if (options.kind === "post") return false;
      const text = `${item.title} ${item.summary} ${item.source} ${item.author} ${item.teams.map(nbaTeamLabel).join(" ")}`.toLowerCase();
      if (!words.every(word => text.includes(word)) || seen.has(item.url)) return false;
      seen.add(item.url); return true;
    }).sort((a, b) => {
      // Hupu relative times and section reply times are kept as source labels,
      // not fabricated publication timestamps; preserve their listing order.
      if (a.status.id !== b.status.id) return a.status.id.localeCompare(b.status.id);
      if (a.item.publishedAt && b.item.publishedAt) return Date.parse(b.item.publishedAt) - Date.parse(a.item.publishedAt);
      return 0;
    });
}
