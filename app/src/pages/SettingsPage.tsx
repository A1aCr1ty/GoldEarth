import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppearanceCard } from "@/components/settings/AppearanceCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { tauri } from "@/lib/tauri";
interface StorageInfo { root: string; totalNotes: number; totalCategories: number; }
export default function SettingsPage() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [binPath, setBinPath] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    tauri.getStorageInfo().then(setInfo).catch((e) => setError(String(e)));
    tauri.getSettings().then((s) => setBinPath(s.agentBinPath ?? "")).catch((e) => setError(String(e)));
  }, []);
  async function handleSaveBinPath() {
    try {
      const s = await tauri.updateSettings({ agentBinPath: binPath.trim() });
      setBinPath(s.agentBinPath ?? "");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-4 text-lg font-semibold">设置</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <AppearanceCard />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>本地存储</CardTitle>
            <CardDescription>所有数据保存在本机，按需备份。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {error && <p className="text-destructive">{error}</p>}
            {info && (
              <>
                <p><span className="text-muted-foreground">存储根目录：</span><code className="ml-1 rounded bg-muted px-1 py-0.5 text-xs">{info.root}</code></p>
                <p><span className="text-muted-foreground">分类数：</span><Badge variant="secondary" className="ml-1">{info.totalCategories}</Badge></p>
                <p><span className="text-muted-foreground">笔记数：</span><Badge variant="secondary" className="ml-1">{info.totalNotes}</Badge></p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>外部 Agent 运行时</CardTitle>
            <CardDescription>指定 Agent 命令的实际地址，避免依赖系统 PATH。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="space-y-1.5">
              <Label htmlFor="agent-bin-path">可执行文件地址（可选）</Label>
              <Input
                id="agent-bin-path"
                value={binPath}
                onChange={(e) => setBinPath(e.target.value)}
                placeholder="留空则只按系统 PATH 查找，或填写完整路径如 C:\\npm\\codex.cmd"
              />
              <p className="text-xs text-muted-foreground">
                可填可执行文件本身（如 <code>codex.cmd</code>），也可填它所在的目录。留空时 App 会自动在 PATH 中查找并兼容 npm 生成的 <code>.cmd</code> 启动器。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSaveBinPath}>保存</Button>
              {saved && <span className="text-xs text-muted-foreground">已保存</span>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>关于</CardTitle>
            <CardDescription>GoldEarth · 个人事务管理</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>前端：React + Vite + TypeScript + Tailwind + shadcn/ui</p>
            <p>后端：Rust + Tauri 2</p>
            <p>笔记格式：Markdown / 纯文本 / 待办</p>
            <p>Agent：可调用本地 CLI（如 Codex）</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
