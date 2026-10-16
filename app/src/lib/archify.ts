import { invoke } from "@tauri-apps/api/core";

export const diagramTypes = {
  architecture: "架构图", workflow: "流程图", sequence: "时序图", dataflow: "数据流图", lifecycle: "状态图",
} as const;
export type DiagramType = keyof typeof diagramTypes;
export interface ArchifyTemplate {
  example: Record<string, unknown>;
  schema: unknown;
  commonSchema: unknown;
  runtime: string | null;
}
export interface ArchifyResult { ok: boolean; html: string | null; receipt: Record<string, unknown>; failureKind?: "runtime" | "diagram" | null }
export type ArchifyExportFormat = "html" | "json" | "both";
export interface ArchifyCategoryExport { directory: string; files: string[] }

export function renderFailureMessage(result: ArchifyResult): string {
  const prefix = result.failureKind === "runtime" ? "Archify 运行失败，请检查运行环境。" : "图表未通过校验。";
  const diagnostics = Array.isArray(result.receipt.diagnostics) ? result.receipt.diagnostics : [];
  const messages = diagnostics.map(d => d && typeof d === "object" && typeof d.message === "string" ? d.message : "").filter(Boolean);
  const detail = messages.slice(0, 3).join("；") || (typeof result.receipt.error === "string" ? result.receipt.error : "请展开校验诊断查看详情。");
  return `${prefix}\n${detail.slice(0, 900)}`;
}
export const archify = {
  template: (diagramType: DiagramType) => invoke<ArchifyTemplate>("archify_template", { diagramType }),
  render: (diagramType: DiagramType, source: string) => invoke<ArchifyResult>("render_archify", { diagramType, source }),
  prepareGeneration: (context: string, prompt: string, diagramType: DiagramType) => invoke<string>("prepare_archify_generation", { context, prompt, diagramType }),
  export: (content: string, format: "html" | "json") => invoke<string | null>("export_archify", { content, format }),
  exportToCategory: (categoryId: string | null, source: string, format: ArchifyExportFormat) => invoke<ArchifyCategoryExport>("export_archify_to_category", { categoryId, source, format }),
  openCategoryFolder: (categoryId: string | null) => invoke<void>("open_archify_category_folder", { categoryId }),
};

/** Apply one supported geometry change from measured diagnostics, never semantic edits. */
export function repairMeasuredLayout(source: string, result: ArchifyResult): string | null {
  if (result.ok || result.failureKind === "runtime") return null;
  let diagram;
  try { diagram = JSON.parse(source); } catch { return null; }
  if (diagram?.diagram_type !== "architecture" || !Array.isArray(diagram.connections)) return null;
  const diagnostics = Array.isArray(result.receipt.diagnostics) ? result.receipt.diagnostics : [];
  for (const diagnostic of diagnostics) {
    const d = diagnostic as Record<string, any>;
    const evidence = d?.evidence;
    if (!evidence || !Array.isArray(d.supportedFixes)) continue;
    if (d.code === "composition/label-route-clearance" && d.supportedFixes.some((fix: unknown) => typeof fix === "string" && fix.includes("labelAt"))) {
      const subject = d.subject;
      const relation = subject?.collection === "connections" && Number.isInteger(subject.index) ? diagram.connections[subject.index] : null;
      const rect = evidence.labelRect, from = evidence.from, to = evidence.to;
      if (!relation || relation.id !== subject.id || relation.from !== subject.from || relation.to !== subject.to || relation.label !== evidence.label) continue;
      if (!rect || !Array.isArray(from) || !Array.isArray(to) ||
          ![rect.lx, rect.ly, rect.width, rect.height, evidence.minimumPx, ...from, ...to].every(v => typeof v === "number" && Number.isFinite(v))) continue;
      if (rect.width <= 0 || rect.height <= 0 || evidence.minimumPx < 0) continue;
      const gap = evidence.minimumPx + 2;
      let x = rect.lx, y = rect.ly;
      if (from[1] === to[1]) {
        // Move beyond the nearest end of the offending horizontal segment.
        const left = Math.min(from[0], to[0]) - rect.width / 2 - gap;
        const right = Math.max(from[0], to[0]) + rect.width / 2 + gap;
        x = Math.abs(x - left) < Math.abs(x - right) ? Math.floor(left) : Math.ceil(right);
      } else if (from[0] === to[0]) {
        const left = from[0] - rect.width / 2 - gap, right = from[0] + rect.width / 2 + gap;
        x = Math.abs(x - left) <= Math.abs(x - right) ? Math.floor(left) : Math.ceil(right);
      } else continue;
      const width = diagram.meta?.viewBox?.[0];
      if (x - rect.width / 2 < 0 || (typeof width === "number" && x + rect.width / 2 > width)) continue;
      relation.labelAt = [x, y];
      const candidate = JSON.stringify(diagram, null, 2);
      if (candidate !== JSON.stringify(JSON.parse(source), null, 2)) return candidate;
    }
    if (d.code === "composition/desktop-readability" && d.supportedFixes.some((fix: unknown) => typeof fix === "string" && fix.includes("viewBox width"))) {
      const box = diagram.meta?.viewBox;
      if (!Array.isArray(box) || !Array.isArray(diagram.components) || ![box[0], evidence.availableDiagramWidth, evidence.sourceFontPx, evidence.minimumProjectedFontPx].every(v => typeof v === "number" && Number.isFinite(v) && v > 0)) continue;
      const width = Math.floor(evidence.availableDiagramWidth * evidence.sourceFontPx / evidence.minimumProjectedFontPx) - 4;
      const right = Math.max(...diagram.components.map((node: any) => Array.isArray(node.pos) && Array.isArray(node.size) ? node.pos[0] + node.size[0] : Infinity));
      // Only trim small redundant right margins; never clip or scale semantic geometry.
      if (width >= 700 && width < box[0] && width >= box[0] * 0.95 && width >= right + 20) {
        diagram.meta.viewBox[0] = width;
        return JSON.stringify(diagram, null, 2);
      }
    }
  }
  return null;
}

export async function renderWithLayoutRepair(type: DiagramType, source: string,
  render: (type: DiagramType, source: string) => Promise<ArchifyResult> = archify.render) {
  let currentSource = source, repairs = 0, best = Infinity, stagnant = 0;
  const seen = new Set([source]);
  while (true) {
    const result = await render(type, currentSource);
    if (result.ok || repairs >= 6 || result.failureKind === "runtime") return { ...result, source: currentSource, repairs };
    const diagnostics = Array.isArray(result.receipt.diagnostics) ? result.receipt.diagnostics : [];
    const count = diagnostics.filter(d => d?.severity !== "warning").length;
    // Final artifact checks reveal additional defects only after renderer checks pass.
    const score = (result.receipt.stage === "check" ? 0 : 1000) + count;
    if (score < best) { best = score; stagnant = 0; } else stagnant++;
    if (stagnant >= 2) return { ...result, source: currentSource, repairs };
    const next = repairMeasuredLayout(currentSource, result);
    if (!next || seen.has(next)) return { ...result, source: currentSource, repairs };
    seen.add(next); currentSource = next; repairs++;
  }
}

export function extractDiagram(output: string, expectedType: DiagramType): string {
  const candidates = [...output.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map(m => m[1]);
  candidates.push(output, output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
  for (const text of candidates) {
    try {
      const value = JSON.parse(text);
      if (value && typeof value === "object" && !Array.isArray(value) && value.diagram_type === expectedType) {
        return JSON.stringify(value, null, 2);
      }
    } catch { /* Try the next complete JSON candidate. */ }
  }
  throw new Error(`Agent 没有返回有效的${diagramTypes[expectedType]} JSON。请查看回复并重试。`);
}

export function generationContext(type: DiagramType, template: ArchifyTemplate, source: string, receipt?: unknown): string {
  return [
    "你是 GoldEarth 内的 Archify 图表设计师。最终回复只输出一个完整的 JSON 对象。按任务文件末尾提供的临时目录和 CLI 校验流程工作。",
    `目标 diagram_type=${type}。将用户的自然语言或 Mermaid 按语义转换为 Archify JSON，保留有意义的关系标签。`,
    '用中文撰写内容，meta.locale="zh-CN"，meta.quality_profile="showcase"。默认静态、classic 风格，不添加副标题。',
    "最多 12 个主要节点，一条清晰主路径，优先自动路由。新 workflow 使用 schema_version: 2。",
    "自动路由不保证标签避让。发生 composition/label-route-clearance 时，依据 labelRect、from/to 和 minimumPx 移动诊断指定关系的 labelAt；每次只改一个诊断对象并重新校验。不得删掉数值标签或降低 showcase 标准。",
    "严格遵守下面的两个 JSON Schema。示例仅供字段和布局参考，不要把示例事实混入用户图表。不要声明已通过校验。",
    "图表 Schema：", JSON.stringify(template.schema), "公共 Schema：", JSON.stringify(template.commonSchema),
    "参考示例：", JSON.stringify(template.example),
    source ? `当前待修改图表：\n${source}` : "",
    receipt ? `上次真实校验诊断（逐项修复，不删除有意义的关系标签）：\n${JSON.stringify(receipt)}` : "",
  ].filter(Boolean).join("\n\n");
}

export const MAX_ARCHIFY_REPAIRS = 2;
export function shouldRepairDiagram(result: ArchifyResult, attempt: number): boolean {
  return !result.ok && result.failureKind !== "runtime" && Number.isInteger(attempt) && attempt >= 0 && attempt < MAX_ARCHIFY_REPAIRS;
}
export interface ArchifyDraft { type: DiagramType; source: string; prompt: string; agentId: string; runId: string | null; repairAttempts: number }
const draftKey = "goldearth.archify.draft.v1";
export function loadArchifyDraft(): ArchifyDraft {
  const empty: ArchifyDraft = { type: "architecture", source: "", prompt: "", agentId: "", runId: null, repairAttempts: 0 };
  try {
    const value = JSON.parse(localStorage.getItem(draftKey) || "null");
    if (!value || !Object.prototype.hasOwnProperty.call(diagramTypes, value.type)) return empty;
    return { type: value.type, source: typeof value.source === "string" ? value.source : "",
      prompt: typeof value.prompt === "string" ? value.prompt : "", agentId: typeof value.agentId === "string" ? value.agentId : "",
      runId: typeof value.runId === "string" ? value.runId : null,
      repairAttempts: Number.isInteger(value.repairAttempts) && value.repairAttempts >= 0 ? Math.min(value.repairAttempts, MAX_ARCHIFY_REPAIRS) : 0 };
  } catch { return empty; }
}
export function saveArchifyDraft(draft: ArchifyDraft) { localStorage.setItem(draftKey, JSON.stringify(draft)); }
