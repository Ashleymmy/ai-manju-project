/**
 * 画布 skill 库：本地存储的提示词优化技能（指令模板）。
 * 后端无对应资源，与 WebDAV 配置一样存 localStorage，支持 JSON 导入/导出。
 */

export type CanvasSkill = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const SKILL_STORAGE_KEY = "ai-manju:canvas_skills";

const DEFAULT_SKILLS: Array<Pick<CanvasSkill, "title" | "description" | "prompt">> = [
  {
    title: "首尾帧风格克隆 + 剧本处理工作流",
    description: "把剧本内容转换为 AI 视频生成平台适用的首尾帧提示词系统",
    prompt: "你是首尾帧风格克隆与剧本处理专家。把输入内容拆解为适合 AI 视频生成的首帧与尾帧提示词，保持角色、场景、光影风格一致，输出可直接用于首尾帧模式的提示词。",
  },
  {
    title: "SD2.0 电影级提示词优化大师",
    description: "交互式 Seedance 2.0 电影级提示词生成与风格选择",
    prompt: "你是电影级提示词优化师。把用户的描述改写为电影级镜头语言：明确机位、焦距感、光影方向、氛围色调与运动节奏，保持主体不变，输出可直接用于视频模型的提示词。",
  },
  {
    title: "视频提示词优化师",
    description: "深耕 AI 视频生成领域的顶级提示词优化专家",
    prompt: "你是视频提示词优化专家。在不改变主体与场景的前提下，补足动作、镜头运动、光影与质感细节，使提示词对视频生成模型更可控、更具体。",
  },
  {
    title: "Seedance 2.0 提示词审核优化器",
    description: "针对 Seedance 2.0 模型的提示词审核与合规优化",
    prompt: "你是 Seedance 2.0 提示词审核优化器。检查提示词是否符合视频生成规范，剔除歧义与冲突描述，保留主体与动作，输出更稳定可生成的版本。",
  },
];

export function loadSkills(): CanvasSkill[] {
  try {
    const raw = window.localStorage.getItem(SKILL_STORAGE_KEY);
    if (!raw) {
      const seeded = DEFAULT_SKILLS.map((item) => createSkillEntry(item));
      persistSkills(seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw) as CanvasSkill[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.id && item.title) : [];
  } catch {
    return DEFAULT_SKILLS.map((item) => createSkillEntry(item));
  }
}

export function persistSkills(skills: CanvasSkill[]) {
  try {
    window.localStorage.setItem(SKILL_STORAGE_KEY, JSON.stringify(skills));
  } catch {
    undefined;
  }
}

export function createSkillEntry(input: Pick<CanvasSkill, "title" | "description" | "prompt">): CanvasSkill {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    description: input.description.trim(),
    prompt: input.prompt.trim(),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function exportSkillsFile(skills: CanvasSkill[]) {
  const blob = new Blob([JSON.stringify({ app: "ai-manju-studio", version: 1, exportedAt: new Date().toISOString(), skills }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `画布技能库-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function importSkillsFile(file: File, existing: CanvasSkill[]) {
  const data = JSON.parse(await file.text()) as { skills?: Array<Partial<CanvasSkill>> };
  const incoming = Array.isArray(data.skills) ? data.skills : [];
  const merged = [...existing];
  for (const item of incoming) {
    if (!item.title?.trim() || !item.prompt?.trim()) continue;
    if (merged.some((skill) => skill.id === item.id)) continue;
    merged.push(createSkillEntry({ title: item.title, description: item.description || "", prompt: item.prompt }));
  }
  persistSkills(merged);
  return merged;
}
