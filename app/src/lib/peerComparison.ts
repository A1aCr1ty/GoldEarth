export interface AgentPeerSelection {
  code: string;
  name: string;
  reason: string;
}

function normalizeCode(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(text)) return text;
  if (!/^\d{6}$/.test(text)) return null;
  return `${/^(4|8|92)/.test(text) ? "bj" : /^[569]/.test(text) ? "sh" : "sz"}${text}`;
}

function outputObject(output: string) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(output)?.[1];
  const source = fenced ?? output;
  for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < source.length; i++) {
      const char = source[i];
      if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; }
      else if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try {
          const value = JSON.parse(source.slice(start, i + 1));
          if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
        } catch { }
        break;
      }
    }
  }
  throw new Error("Agent 回复不是有效的同行筛选 JSON");
}

export function parseAgentPeerSelection(output: string, currentCode: string) {
  const current = normalizeCode(currentCode);
  if (!current) throw new Error("当前证券代码无效");
  const data = outputObject(output);
  if (data.schemaVersion !== 1 || normalizeCode(data.currentCode) !== current) throw new Error("Agent 回复未匹配当前公司");
  if (typeof data.industry !== "string" || !data.industry.trim()) throw new Error("Agent 未提供行业名称");
  if (!Array.isArray(data.peers)) throw new Error("Agent 未提供同行公司列表");
  const peers: AgentPeerSelection[] = [];
  const seen = new Set<string>([current]);
  for (const value of data.peers) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const code = normalizeCode(item.code);
    if (!code || seen.has(code) || typeof item.name !== "string" || !item.name.trim() || typeof item.reason !== "string" || !item.reason.trim()) continue;
    seen.add(code);
    peers.push({ code, name: item.name.trim().slice(0, 100), reason: item.reason.trim().slice(0, 1000) });
    if (peers.length === 4) break;
  }
  if (!peers.length) throw new Error("Agent 没有返回可验证的同行公司");
  return { industry: data.industry.trim().slice(0, 200), peers };
}
