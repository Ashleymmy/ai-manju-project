/**
 * 聊天台 → 画布的引导信息接力。
 *
 * SOP：用户在聊天台输入想法发送后，
 *   1. 静默新建画布（ChatView 调用 createProject，对用户透明）
 *   2. 打开画布（全程加载动画覆盖，由 ChatView 与画布页接力）
 *   3. 创建相关节点（随项目数据落地，画布打开即渲染）
 *   4. 唤出 Agent 对话卡片
 *   5. 同步输入的对话内容（作为用户消息自动发送到 Agent）
 *   6. 和用户进行操作确认（Agent 面板既有的「等待确认」卡片）
 *   7. 操作节点（用户确认后执行画布工具）
 *
 * 步骤 1 产出的 projectId 与步骤 5 需要的用户原文，经 sessionStorage 跨路由传递；
 * 画布页读取后立即消费（一次性），刷新或再次进入不会重复触发。
 */

export type CanvasBootstrapPayload = {
  projectId: string;
  prompt: string;
  createdAt: number;
};

const STORAGE_KEY = "ai-manju:canvas-bootstrap";
/** 引导信息有效期：超过视为残留数据，不再触发自动流程 */
const MAX_AGE_MS = 5 * 60_000;

function readPayload(): CanvasBootstrapPayload | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CanvasBootstrapPayload>;
    if (typeof parsed.projectId !== "string" || !parsed.projectId) return null;
    if (typeof parsed.prompt !== "string" || !parsed.prompt.trim()) return null;
    if (typeof parsed.createdAt !== "number" || Date.now() - parsed.createdAt > MAX_AGE_MS) return null;
    return { projectId: parsed.projectId, prompt: parsed.prompt, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

/** 步骤 2 起点：聊天台在跳转前写入引导信息 */
export function setCanvasBootstrap(projectId: string, prompt: string) {
  try {
    const payload: CanvasBootstrapPayload = { projectId, prompt, createdAt: Date.now() };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage 不可用时静默降级：画布照常打开，仅不触发自动流程
  }
}

/** 画布页首屏判断是否处于引导流程（只读，不消费），用于立即覆盖加载动画 */
export function peekCanvasBootstrap(projectId: string): boolean {
  const payload = readPayload();
  return Boolean(payload && payload.projectId === projectId);
}

/** 画布页消费引导信息（一次性）：返回用户输入原文，无匹配时返回空串 */
export function consumeCanvasBootstrap(projectId: string): string {
  const payload = readPayload();
  if (!payload || payload.projectId !== projectId) return "";
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略清理失败
  }
  return payload.prompt;
}
