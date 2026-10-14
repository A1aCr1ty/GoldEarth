import { useEffect, useState } from "react";
import { Check, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { tauri } from "@/lib/tauri";
import type { IndexOption } from "@/types";

/**
 * 指数选择器：勾选顶部指数条要展示哪些指数，结果存进 settings。
 * 不勾任何项时后端会回落到默认那六个。
 */
export function IndexPicker({ selected, onSaved }: { selected: string[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<IndexOption[]>([]);
  const [picked, setPicked] = useState<string[]>(selected);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPicked(selected);
  }, [selected]);

  async function ensureLoaded() {
    if (options.length > 0) return;
    try {
      setOptions(await tauri.availableIndices());
    } catch {
      setOptions([]);
    }
  }

  function toggle(code: string) {
    setPicked((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const s = await tauri.getSettings();
      await tauri.updateSettings({ agentBinPath: s.agentBinPath, indexCodes: picked });
      setOpen(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) void ensureLoaded();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Settings2 className="h-3.5 w-3.5" /> 指数设置
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>选择展示的指数</DialogTitle>
          <DialogDescription>
            勾选后会显示在看板顶部的指数条上。不勾任何项则使用默认的六个。
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-80 grid-cols-2 gap-1.5 overflow-y-auto">
          {options.length === 0 && <p className="col-span-2 py-6 text-center text-xs text-muted-foreground">加载中…</p>}
          {options.map((o) => {
            const on = picked.includes(o.code);
            return (
              <button
                key={o.code}
                onClick={() => toggle(o.code)}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
                  on ? "border-primary bg-primary/5" : "hover:bg-accent"
                }`}
              >
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                    on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                  }`}
                >
                  {on && <Check className="h-2.5 w-2.5" />}
                </span>
                <span className="truncate">{o.name}</span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-between">
          <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
            清空
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}