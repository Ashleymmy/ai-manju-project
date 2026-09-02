import localforage from "localforage";

import type { VideoGenerationConfig } from "./api/video";
import type { WorkspaceScope } from "./api/projects";

/* 视频工作台（对话式）的本地持久化层：IndexedDB。
   后端目前没有对话/消息表，对话模型先落在本机；任务执行仍走既有 Go API。
   参考视频历史的写入模式：单调 revision + 串行写队列，避免并发覆盖。 */

export type VideoWorkbenchAttachmentRole = "reference" | "first_frame" | "last_frame";

export type VideoWorkbenchAttachment = {
  id: string;
  kind: "image" | "video" | "audio";
  role: VideoWorkbenchAttachmentRole;
  /** 提示词中的引用 token，如 @图片1；仅参考类素材有 */
  token?: string;
  name: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  /** 本机草稿媒体（video_generation_media 存储的 key） */
  storageKey?: string;
  /** 资产库引用 */
  assetId?: string;
  scope?: WorkspaceScope;
};

export type VideoWorkbenchTaskStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type VideoWorkbenchMessage = {
  id: string;
  role: "user" | "system";
  text: string;
  createdAt: number;
  attachments?: VideoWorkbenchAttachment[];
  /** 系统消息 = 任务卡：以下字段让卡片在刷新后仍能完整渲染 */
  taskId?: string;
  taskProvider?: "openai" | "seedance";
  taskStatus?: VideoWorkbenchTaskStatus;
  taskError?: string;
  taskProgress?: number;
  resultAssetId?: string;
  resultScope?: WorkspaceScope;
  /** 本机结果媒体（workbench media store 的 key） */
  resultStorageKey?: string;
  fileName?: string;
  model?: string;
  config?: VideoGenerationConfig;
};

export type VideoWorkbenchConversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: VideoWorkbenchMessage[];
};

type ConversationEnvelope = {
  version: 1;
  revision: number;
  items: VideoWorkbenchConversation[];
};

const conversationStore = localforage.createInstance({
  name: "ai-manhua-studio",
  storeName: "video_workbench_conversations_v1",
});

const storeKey = "conversations";

/* 工作台自有媒体仓：附件（wb:{消息id}:{附件id}）与生成结果（wbresult:{消息id}）。
   独立于视频历史的 media store，删除对话时按键前缀清理。 */
const workbenchMediaStore = localforage.createInstance({
  name: "ai-manhua-studio",
  storeName: "video_workbench_media_v1",
});

export async function storeWorkbenchMedia(key: string, blob: Blob) {
  await workbenchMediaStore.setItem(key, blob);
}

export async function loadWorkbenchMedia(key: string) {
  const blob = await workbenchMediaStore.getItem<Blob>(key);
  if (!(blob instanceof Blob)) throw new Error("本地媒体已丢失");
  return blob;
}

export async function removeWorkbenchMedia(key?: string) {
  if (key) await workbenchMediaStore.removeItem(key);
}

/** 删除对话时清理该对话全部本地媒体（附件 + 结果）。 */
export async function removeWorkbenchMediaByPrefix(prefix: string) {
  const keys = await workbenchMediaStore.keys();
  await Promise.all(keys.filter((key) => key.startsWith(prefix)).map((key) => workbenchMediaStore.removeItem(key)));
}

export function workbenchAttachmentMediaKey(messageId: string, attachmentId: string) {
  return `wb:${messageId}:${attachmentId}`;
}

export function workbenchResultMediaKey(messageId: string) {
  return `wbresult:${messageId}`;
}

/** 附件入库：本地文件复制到工作台媒体仓，资产引用只记 assetId。 */
export async function persistWorkbenchAttachment(
  messageId: string,
  attachment: VideoWorkbenchAttachment,
  file?: File,
): Promise<VideoWorkbenchAttachment> {
  if (attachment.assetId) return { ...attachment, storageKey: undefined };
  if (!file) throw new Error(`${attachment.name} 缺少本地文件`);
  const key = workbenchAttachmentMediaKey(messageId, attachment.id);
  await storeWorkbenchMedia(key, file);
  return { ...attachment, storageKey: key };
}

let writeTail: Promise<void> = Promise.resolve();
let requestedRevision = 0;

export async function loadVideoWorkbenchConversations() {
  await flushVideoWorkbenchWrites();
  const envelope = await conversationStore.getItem<ConversationEnvelope>(storeKey);
  requestedRevision = Math.max(requestedRevision, envelope?.revision || 0);
  return normalizeConversations(envelope?.items);
}

export function queueVideoWorkbenchWrite(items: VideoWorkbenchConversation[]) {
  const revision = ++requestedRevision;
  const snapshot = normalizeConversations(items);
  const operation = writeTail
    .catch(() => undefined)
    .then(async () => {
      await conversationStore.setItem<ConversationEnvelope>(storeKey, {
        version: 1,
        revision,
        items: snapshot,
      });
    });
  writeTail = operation;
  return operation;
}

export async function flushVideoWorkbenchWrites() {
  await writeTail;
}

export function createVideoWorkbenchConversation(title = "新对话"): VideoWorkbenchConversation {
  const now = Date.now();
  return {
    id: runtimeId("conv"),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function createVideoWorkbenchMessage(
  role: VideoWorkbenchMessage["role"],
  text: string,
  extra: Partial<VideoWorkbenchMessage> = {},
): VideoWorkbenchMessage {
  return {
    id: runtimeId("msg"),
    role,
    text,
    createdAt: Date.now(),
    ...extra,
  };
}

/** 对话标题：首条用户消息的前 24 字。 */
export function conversationTitleFromMessage(text: string) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 24) : "新对话";
}

function normalizeConversations(value: unknown): VideoWorkbenchConversation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeConversation)
    .filter((item): item is VideoWorkbenchConversation => Boolean(item))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function normalizeConversation(value: unknown): VideoWorkbenchConversation | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (!id) return null;
  return {
    id,
    title: stringValue(value.title) || "新对话",
    createdAt: finiteNumber(value.createdAt) || Date.now(),
    updatedAt: finiteNumber(value.updatedAt) || Date.now(),
    messages: Array.isArray(value.messages)
      ? value.messages.map(normalizeMessage).filter((item): item is VideoWorkbenchMessage => Boolean(item))
      : [],
  };
}

function normalizeMessage(value: unknown): VideoWorkbenchMessage | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (!id) return null;
  return {
    id,
    role: value.role === "system" ? "system" : "user",
    text: stringValue(value.text),
    createdAt: finiteNumber(value.createdAt) || Date.now(),
    attachments: Array.isArray(value.attachments)
      ? value.attachments.map(normalizeAttachment).filter((item): item is VideoWorkbenchAttachment => Boolean(item))
      : undefined,
    taskId: stringValue(value.taskId) || undefined,
    taskProvider: value.taskProvider === "openai" || value.taskProvider === "seedance" ? value.taskProvider : undefined,
    taskStatus: normalizeTaskStatus(value.taskStatus),
    taskError: stringValue(value.taskError) || undefined,
    taskProgress: finiteNumber(value.taskProgress),
    resultAssetId: stringValue(value.resultAssetId) || undefined,
    resultScope: value.resultScope === "team" ? "team" : value.resultScope === "personal" ? "personal" : undefined,
    resultStorageKey: stringValue(value.resultStorageKey) || undefined,
    fileName: stringValue(value.fileName) || undefined,
    model: stringValue(value.model) || undefined,
    config: isRecord(value.config) ? value.config as unknown as VideoGenerationConfig : undefined,
  };
}

function normalizeTaskStatus(value: unknown): VideoWorkbenchTaskStatus | undefined {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "canceled"
    ? value
    : undefined;
}

function normalizeAttachment(value: unknown): VideoWorkbenchAttachment | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const kind = value.kind === "image" || value.kind === "video" || value.kind === "audio" ? value.kind : null;
  if (!id || !kind) return null;
  const role = value.role === "first_frame" || value.role === "last_frame" ? value.role : "reference";
  return {
    id,
    kind,
    role,
    token: stringValue(value.token) || undefined,
    name: stringValue(value.name) || `${kind}.bin`,
    mime: stringValue(value.mime) || "application/octet-stream",
    bytes: finiteNumber(value.bytes) || 0,
    width: finiteNumber(value.width),
    height: finiteNumber(value.height),
    durationMs: finiteNumber(value.durationMs),
    storageKey: stringValue(value.storageKey) || undefined,
    assetId: stringValue(value.assetId) || undefined,
    scope: value.scope === "team" ? "team" : value.scope === "personal" ? "personal" : undefined,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function runtimeId(prefix: string) {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`}`;
}
