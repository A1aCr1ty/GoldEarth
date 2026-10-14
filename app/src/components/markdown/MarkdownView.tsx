import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 对话面板每收到一段流式文本就会重渲染整条消息列表，
 * 而 react-markdown + remark-gfm 解析一段长文本并不便宜——
 * 历史消息反复被重新解析是 Agent 运行期间界面卡住的主因。
 *
 * memo 之后：历史消息的 source 字符串不变就不会再解析，
 * 只有正在流式输出的那一条会重新渲染。
 */
export const MarkdownView = memo(function MarkdownView({ source }: { source: string }) {
  return (
    <div className="prose prose-slate max-w-none dark:prose-invert prose-sm prose-headings:my-2 prose-p:my-1 prose-pre:rounded-md prose-pre:bg-muted">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
});