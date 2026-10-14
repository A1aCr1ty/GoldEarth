import { useEffect, useState } from "react";
import { MdEditor } from "md-editor-rt";
import type { Themes } from "md-editor-rt";
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

/**
 * Typora 式所见即所得 Markdown 编辑器：默认开启实时预览，编辑时看不到
 * # / * 等语法标记，光标所在处才显示原始语法。存储格式仍是标准 Markdown。
 */
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
  return (
    // md-editor-rt 自带的样式是写死的 px（400 多处），改根字号对它无效，
    // 所以这里用 zoom 跟着全局缩放；容器 overflow-hidden 兜住取整误差，
    // 编辑器内部本来就有自己的滚动区。
    <div className="min-h-0 flex-1 overflow-hidden" style={{ zoom: "var(--ui-scale, 1)" }}>
      <MdEditor
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
  );
}
