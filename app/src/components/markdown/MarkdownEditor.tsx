import { useEffect, useRef, useState } from "react";
import { MdEditor, MdPreview } from "md-editor-rt";
import type { ExposeParam, Themes } from "md-editor-rt";
import "md-editor-rt/lib/style.css";

/**
 * 跟随 <html class="dark"> 同步编辑器主题。
 * tailwind.config.js 里声明了 darkMode: ["class"]，这里保证后续接上主题切换时无需再改。
 */
function useAppTheme(): Themes {
  const [theme, setTheme] = useState<Themes>("light");
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const theme = useAppTheme();
  const [mode, setMode] = useState<"source" | "split" | "read">("source");
  const editorRef = useRef<ExposeParam>(null);
  useEffect(() => {
    // preview is an initial setting in md-editor-rt, not a controlled prop.
    // Use the instance API so switching modes preserves the undo history.
    editorRef.current?.togglePreview(mode === "split");
  }, [mode]);
  return (
    // md-editor-rt 自带的样式是写死的 px（400 多处），改根字号对它无效，
    // 所以这里用 zoom 跟着全局缩放；容器 overflow-hidden 兜住取整误差，
    // 编辑器内部本来就有自己的滚动区。
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ zoom: "var(--ui-scale, 1)" }}>
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <span className="text-xs text-muted-foreground">Markdown</span>
        <div className="flex gap-1" role="group" aria-label="编辑模式">
          {([["source", "源码"], ["split", "双栏"], ["read", "阅读"]] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}
              className={"rounded px-3 py-1 text-xs transition-colors hover:bg-accent " + (mode === id ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>{label}</button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
      {mode === "read" && <MdPreview modelValue={value} theme={theme} previewTheme="github" className="mx-auto max-w-3xl px-6 py-8" />}
      <div className="h-full" hidden={mode === "read"}>
      <MdEditor
        ref={editorRef}
        preview={false}
        toolbars={["bold", "italic", "title", "quote", "unorderedList", "orderedList", "task", "code", "link", "table", "revoke", "next"]}
        value={value}
        onChange={onChange}
        theme={theme}
        previewTheme="github"
        language="zh-CN"
        placeholder={placeholder}
        /* 应用没有图片存储后端，关掉上传避免点了没反应 */
        noUploadImg
        /* 关闭自动格式化，防止保存时重排用户手写的 Markdown 造成光标跳动 */
        noPrettier
        style={{ height: "100%" }}
      />
      </div>
      </div>
    </div>
  );
}
