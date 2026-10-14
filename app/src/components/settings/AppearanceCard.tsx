import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { errText } from "@/lib/errors";
import { tauri } from "@/lib/tauri";
import {
  ACCENT_PRESETS,
  FONT_PRESETS,
  FONT_SCALES,
  THEME_MODES,
  accentSwatch,
  accentSwatchText,
  setAppearance,
  useAppearance,
  useResolvedTheme,
  type Appearance,
} from "@/lib/appearance";

/**
 * 外观设置：主题模式 / 主题色 / 字体 / 字号。
 *
 * 点一下立刻生效并落盘到 settings.json —— 外观这种东西所见即所得才好挑，
 * 多一步「保存」反而别扭。写盘失败时界面已经变了，所以单独提示一句。
 */
export function AppearanceCard() {
  const appearance = useAppearance();
  // 跟随系统时要按系统深浅色取色块颜色，所以用生效值而不是设置值
  const resolved = useResolvedTheme();
  const [error, setError] = useState<string | null>(null);

  async function change(patch: Partial<Appearance>) {
    const next = setAppearance({ ...appearance, ...patch });
    try {
      // 只传外观这四项：后端是局部更新，不会碰其他设置
      await tauri.updateSettings({
        theme: next.theme,
        accent: next.accent,
        font: next.font,
        fontScale: next.fontScale,
      });
      setError(null);
    } catch (e) {
      setError(`外观没保存上：${errText(e)}`);
    }
  }

  const activeTheme = THEME_MODES.find((mode) => mode.key === appearance.theme) ?? THEME_MODES[0];
  const activeAccent =
    ACCENT_PRESETS.find((preset) => preset.key === appearance.accent) ?? ACCENT_PRESETS[0];
  const activeFont = FONT_PRESETS.find((preset) => preset.key === appearance.font) ?? FONT_PRESETS[0];
  const activeScale =
    FONT_SCALES.find((scale) => scale.value === appearance.fontScale) ?? FONT_SCALES[1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>外观</CardTitle>
        <CardDescription>主题色、深浅色、字体和字号，点一下立即生效并保存。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label>主题模式</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="主题模式">
              {THEME_MODES.map((mode) => (
                <Button
                  key={mode.key}
                  size="sm"
                  variant={appearance.theme === mode.key ? "default" : "outline"}
                  aria-pressed={appearance.theme === mode.key}
                  onClick={() => void change({ theme: mode.key })}
                >
                  {mode.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              选「跟随系统」后，系统切到深色这里也会跟着变，不用再进来调。
            </p>
          </div>

          <div className="space-y-2">
            <Label>主题色</Label>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="主题色">
              {ACCENT_PRESETS.map((preset) => {
                const selected = appearance.accent === preset.key;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    title={preset.label}
                    aria-label={preset.label}
                    aria-pressed={selected}
                    onClick={() => void change({ accent: preset.key })}
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full border transition-opacity",
                      selected
                        ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                        : "hover:opacity-75"
                    )}
                    style={{
                      backgroundColor: accentSwatch(preset, resolved),
                      color: accentSwatchText(preset, resolved),
                    }}
                  >
                    {selected && <Check className="h-3.5 w-3.5" />}
                  </button>
                );
              })}
              <span className="text-xs text-muted-foreground">{activeAccent.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              按钮、选中项、输入框描边这些用主色的地方会一起换。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="appearance-font">字体</Label>
            <Select value={appearance.font} onValueChange={(value) => void change({ font: value })}>
              <SelectTrigger id="appearance-font">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_PRESETS.map((preset) => (
                  <SelectItem key={preset.key} value={preset.key}>
                    {preset.label}（{preset.hint}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div
              className="rounded-md border bg-muted/40 px-3 py-2 text-sm"
              style={{ fontFamily: activeFont.stack }}
            >
              股票 600519 +1.23%　知识库 · ABC abc 0123
            </div>
            <p className="text-xs text-muted-foreground">
              {activeFont.hint}；界面上这个字体也用在 Markdown 预览里，编辑区和股票数字仍是等宽，方便对齐。
            </p>
          </div>

          <div className="space-y-2">
            <Label>字号</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="字号">
              {FONT_SCALES.map((scale) => (
                <Button
                  key={scale.label}
                  size="sm"
                  variant={appearance.fontScale === scale.value ? "default" : "outline"}
                  aria-pressed={appearance.fontScale === scale.value}
                  onClick={() => void change({ fontScale: scale.value })}
                >
                  {scale.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              这是字号偏好，会和「跟着窗口自动缩放」叠在一起算（基准 16px × 倍数 × 窗口比例）。
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          当前：{activeTheme.label} · {activeAccent.label} · {activeFont.label} · {activeScale.label}
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
