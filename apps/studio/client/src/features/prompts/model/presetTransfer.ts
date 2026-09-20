import type { PromptPreset } from "@/entities/prompt";

/** 与现有一键导出的文件标识和版本保持兼容。 */
const PRESET_FILE_APP = "ai-manju-studio";
const PRESET_FILE_VERSION = 1;
/** 限制与 apps/api/internal/handler/user_preference.go 一致，避免服务端静默截断。 */
const PRESET_LIMITS = { count: 100, id: 96, title: 120, prompt: 4000, tags: 12, tag: 48, timestamp: 64, sortOrder: 1_000_000 };
/** 足以容纳 100 条完整 Unicode 预设，同时限制文件读取开销。 */
export const MAX_PROMPT_PRESET_FILE_BYTES = 2 * 1024 * 1024;

export function serializePromptPresetFile(presets: readonly PromptPreset[]) {
  return JSON.stringify({ app: PRESET_FILE_APP, version: PRESET_FILE_VERSION, exportedAt: new Date().toISOString(), presets }, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validString(value: unknown, limit: number, allowEmpty = false): value is string {
  return typeof value === "string" && (allowEmpty || Boolean(value.trim())) && Array.from(value).length <= limit;
}

function isPreset(value: unknown): value is PromptPreset {
  return isRecord(value)
    && validString(value.id, PRESET_LIMITS.id)
    && validString(value.title, PRESET_LIMITS.title)
    && validString(value.prompt, PRESET_LIMITS.prompt)
    && Array.isArray(value.tags) && value.tags.length <= PRESET_LIMITS.tags
    && value.tags.every(tag => validString(tag, PRESET_LIMITS.tag))
    && typeof value.priority === "string" && ["pinned", "high", "normal", "low"].includes(value.priority)
    && typeof value.sort_order === "number" && Number.isInteger(value.sort_order)
    && value.sort_order >= 0 && value.sort_order <= PRESET_LIMITS.sortOrder
    && validString(value.createdAt, PRESET_LIMITS.timestamp, true)
    && validString(value.updatedAt, PRESET_LIMITS.timestamp, true);
}

export function parsePromptPresetFile(text: string): PromptPreset[] {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("文件不是有效的 JSON，请选择“一键导出”生成的预设文件");
  }
  if (!isRecord(data) || data.app !== PRESET_FILE_APP || !Array.isArray(data.presets)) {
    throw new Error("文件格式不正确，请选择“一键导出”生成的预设文件");
  }
  if (data.version !== PRESET_FILE_VERSION) throw new Error("暂不支持此预设文件版本");
  if (!data.presets.length) throw new Error("文件中没有可导入的预设");
  if (data.presets.length > PRESET_LIMITS.count) throw new Error(`单个文件最多支持 ${PRESET_LIMITS.count} 条预设`);
  return data.presets.map((item, index) => {
    if (!isPreset(item)) {
      throw new Error(`第 ${index + 1} 条预设格式不正确或超出长度限制（标题 ${PRESET_LIMITS.title} 字、正文 ${PRESET_LIMITS.prompt} 字），请检查后重新导入`);
    }
    // 只接收预设字段；空白与标签去重和服务端保持一致。
    return {
      id: item.id.trim(), title: item.title.trim(), prompt: item.prompt.trim(),
      tags: [...new Set(item.tags.map(tag => tag.trim()))], priority: item.priority,
      sort_order: item.sort_order, createdAt: item.createdAt.trim(), updatedAt: item.updatedAt.trim(),
    };
  });
}

function contentKey(item: PromptPreset) {
  return JSON.stringify([item.title.trim(), item.prompt.trim(), [...new Set(item.tags.map(tag => tag.trim()))].sort(), item.priority]);
}

export function mergePromptPresetImport(existing: readonly PromptPreset[], imported: readonly PromptPreset[]) {
  const presets = [...existing];
  const ids = new Set(existing.map(item => item.id));
  const contents = new Set(existing.map(contentKey));
  let skipped = 0;
  let firstImportedId = "";
  for (const item of imported) {
    const key = contentKey(item);
    if (contents.has(key)) { skipped++; continue; }
    // 同 ID 的不同内容另存为新预设，避免覆盖用户已编辑的版本。
    let id = item.id;
    while (ids.has(id)) id = crypto.randomUUID();
    presets.push({ ...item, id });
    ids.add(id);
    contents.add(key);
    firstImportedId ||= id;
  }
  if (presets.length > PRESET_LIMITS.count) {
    throw new Error(`导入后将有 ${presets.length} 条预设，超过 ${PRESET_LIMITS.count} 条上限。请先整理现有预设后再导入`);
  }
  if (firstImportedId && existing.some(item => !isPreset(item))) {
    throw new Error("现有预设包含未填写完整或超出限制的内容，请先完善后再导入");
  }
  return { presets, added: presets.length - existing.length, skipped, firstImportedId };
}
