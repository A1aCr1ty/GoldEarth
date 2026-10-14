/** 把 Tauri invoke 抛出来的错误整理成能直接显示的一句话 */
export function errText(e: unknown): string {
  const s = String(e);
  return s.startsWith("Error:") ? s.slice(7).trim() : s;
}