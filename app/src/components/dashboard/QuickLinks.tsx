import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Bot, FileText, FolderTree, TrendingUp, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { tauri } from "@/lib/tauri";

interface QuickLink {
  to: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** 有统计数字时替换 hint */
  countKey?: "notes" | "categories";
}

const LINKS: QuickLink[] = [
  { to: "/stocks", label: "股票看板", hint: "实时行情 · K 线", icon: TrendingUp },
  { to: "/notes", label: "笔记", hint: "Markdown / 待办", icon: FileText, countKey: "notes" },
  { to: "/categories", label: "分类", hint: "整理事务", icon: FolderTree, countKey: "categories" },
  { to: "/agents", label: "Agent", hint: "本地 CLI 对话", icon: Bot },
];

export function QuickLinks() {
  const [counts, setCounts] = useState<{ notes: number; categories: number } | null>(null);

  useEffect(() => {
    tauri
      .getStorageInfo()
      .then((info) => setCounts({ notes: info.totalNotes, categories: info.totalCategories }))
      .catch(() => {
        // 首页入口拿不到统计也不影响跳转
      });
  }, []);

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">快捷入口</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 p-4 pt-0">
        {LINKS.map(({ to, label, hint, icon: Icon, countKey }) => (
          <NavLink
            key={to}
            to={to}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate">{label}</span>
              <span className="block truncate text-[0.6875rem] text-muted-foreground">{hintFor(hint, countKey, counts)}</span>
            </span>
          </NavLink>
        ))}
      </CardContent>
    </Card>
  );
}

function hintFor(hint: string, countKey: QuickLink["countKey"], counts: { notes: number; categories: number } | null): string {
  if (!countKey || !counts) return hint;
  const value = counts[countKey];
  return countKey === "notes" ? `${value} 篇` : `${value} 个`;
}