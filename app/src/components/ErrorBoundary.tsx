import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** 组件栈只在开发构建里有，打包后可能是空的 */
  stack?: string;
}

/**
 * 兜住渲染期的异常。
 *
 * 没有它的时候，任何一次渲染抛错都会让 React 直接卸载整棵树，
 * 表现就是「整个窗口一片空白、也刷新不出来」——既看不到任何提示，
 * 更没有自救入口，只能重启进程。加上之后至少能看到出错内容并一键重载。
 *
 * 只接渲染/生命周期里的错误；事件回调、未处理的 Promise 这类
 * 不会让整棵树消失的错，在 main.tsx 里记到控制台就够了。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 完整上下文留一份到控制台，方便用 DevTools 复现时对照
    console.error("[GoldEarth] 渲染失败", error, info.componentStack);
    this.setState({ stack: info.componentStack ?? undefined });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleCopy = async () => {
    const { error, stack } = this.state;
    const text = [`${error?.name}: ${error?.message}`, error?.stack, stack]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板不可用（非安全上下文等）时就这样，用户可以手动选中上面的文本
    }
  };

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <h2 className="text-base font-medium">界面出错了，页面已停止渲染</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          点「重新加载」通常就能恢复。如果每次都复现，把下面这段发出来可以定位到具体组件。
        </p>
        <pre className="max-h-72 w-full max-w-2xl overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs whitespace-pre-wrap">
          {`${error.name}: ${error.message}`}
          {error.stack ? `\n\n${error.stack}` : ""}
          {stack ? `\n\n${stack}` : ""}
        </pre>
        <div className="flex gap-2">
          <Button size="sm" onClick={this.handleReload}>
            重新加载
          </Button>
          <Button size="sm" variant="outline" onClick={() => void this.handleCopy()}>
            复制错误详情
          </Button>
        </div>
      </div>
    );
  }
}