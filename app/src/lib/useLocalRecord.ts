import { useState } from "react";

/** Write before committing UI state so quota / privacy errors never look like a saved record. */
export function useLocalRecord<T>(key: string, initial: T) {
  const [error, setError] = useState("");
  const [value, setValue] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : initial; }
    catch { return initial; }
  });
  function save(next: T) {
    try { localStorage.setItem(key, JSON.stringify(next)); setValue(next); setError(""); return true; }
    catch { setError("本机存储失败，请检查可用空间。当前更改尚未保存。"); return false; }
  }
  return { value, save, error };
}
