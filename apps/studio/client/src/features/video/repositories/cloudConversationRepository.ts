import { createSDVideoClient, type VideoMessageRecord } from "@/entities/sd-video";
import { uploadAsset } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";
import {
  conversationStore, loadVideoWorkbenchConversations, normalizeConversations, queueVideoWorkbenchWrite,
  type VideoWorkbenchAttachment, type VideoWorkbenchConversation, type VideoWorkbenchMessage,
} from "./conversationRepository";

type CachedConversations = { items: VideoWorkbenchConversation[]; draftIds: string[]; pendingMessages?: Record<string, string[]> };
const timestamp = (value: number | string | undefined) => typeof value === "number" ? value * 1000 : Date.parse(value || "") || Date.now();

/** 记录级同步；旧 conversations key 只容纳原有无归属历史，绝不自动上传。 */
export function createCloudConversationRepository(ownerId: string, scope: WorkspaceScope = "personal") {
  const controller = new AbortController();
  const api = createSDVideoClient(scope, controller.signal);
  const cacheKey = `cloud:${scope}:${ownerId}`;
  const legacyIds = new Set<string>();
  const conversationVersions = new Map<string, number>();
  const messageVersions = new Map<string, number>();
  let saved = new Map<string, VideoWorkbenchConversation>();
  let tail: Promise<void> = Promise.resolve();
  let failure: unknown;
  let loaded = false;

  function fromMessage(row: VideoMessageRecord): VideoWorkbenchMessage {
    messageVersions.set(row.id, row.version);
    // 服务端不保存本机 Blob key；任务卡扩展字段仍走现有 codec。
    return normalizeConversations([{ id: "decode", messages: [{ ...row.metadata, id: row.id,
      role: row.role, text: row.text, attachments: row.attachments, createdAt: timestamp(row.created_at) }] }])[0].messages[0];
  }

  function messageBody(conversationId: string, message: VideoWorkbenchMessage) {
    const { id, role, text, attachments, resultStorageKey: _localResult, ...metadata } = message;
    return { id, conversation_id: conversationId, role, text, metadata,
      attachments: (attachments || []).map(({ storageKey: _localInput, ...attachment }) => attachment) };
  }

  async function cacheDrafts(items: VideoWorkbenchConversation[]) {
    await conversationStore.setItem<CachedConversations>(cacheKey, {
      items,
      draftIds: items.filter(item => !saved.has(item.id)).map(item => item.id),
      pendingMessages: Object.fromEntries(items.map(item => [item.id, item.messages
        .filter(message => !saved.get(item.id)?.messages.some(previous => previous.id === message.id))
        .map(message => message.id)])),
    });
  }

  async function sync(snapshot: VideoWorkbenchConversation[]) {
    if (controller.signal.aborted) throw new DOMException("Disposed", "AbortError");
    if (!loaded) throw new Error("服务端对话尚未加载，请刷新后重试");
    const remote = snapshot.filter(item => !legacyIds.has(item.id));
    // 先存草稿，网络失败仍可在相同账号的缓存中找回；不伪称已同步。
    await cacheDrafts(remote);
    for (const item of remote) {
      let previous = saved.get(item.id);
      if (!previous) {
        const created = await api.createConversation(item.id, item.title);
        conversationVersions.set(item.id, created.version);
        previous = { ...item, messages: [] };
        saved.set(item.id, previous);
        await cacheDrafts(remote);
      }
      if (previous.title !== item.title) {
        const updated = await api.renameConversation(item.id, item.title, conversationVersions.get(item.id)!);
        conversationVersions.set(item.id, updated.version);
        previous = { ...previous, title: item.title };
        saved.set(item.id, previous);
      }
      for (const message of item.messages) {
        const before = previous.messages.find(current => current.id === message.id);
        if (before && JSON.stringify(messageBody(item.id, before)) === JSON.stringify(messageBody(item.id, message))) continue;
        const body = messageBody(item.id, message);
        const updated = before
          ? await api.updateMessage(message.id, body, messageVersions.get(message.id)!)
          : await api.createMessage(body);
        messageVersions.set(message.id, updated.version);
        previous = { ...previous, messages: [...previous.messages.filter(current => current.id !== message.id), message] };
        saved.set(item.id, previous);
        await cacheDrafts(remote);
      }
    }
    const retained = new Set(remote.map(item => item.id));
    for (const id of saved.keys()) {
      if (!retained.has(id)) {
        await api.deleteConversation(id);
        saved.delete(id);
        conversationVersions.delete(id);
      }
    }
    await queueVideoWorkbenchWrite(snapshot.filter(item => legacyIds.has(item.id)));
    await conversationStore.setItem<CachedConversations>(cacheKey, { items: remote, draftIds: [] });
  }

  return {
    async load() {
      const legacy = await loadVideoWorkbenchConversations();
      legacy.forEach(item => legacyIds.add(item.id));
      const cached = await conversationStore.getItem<CachedConversations>(cacheKey);
      const rows = await api.conversations();
      const cloud = await Promise.all(rows.map(async row => {
        conversationVersions.set(row.id, row.version);
        return { id: row.id, title: row.title, createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at), messages: (await api.messages(row.id)).map(fromMessage) };
      }));
      saved = new Map(cloud.map(item => [item.id, structuredClone(item)]));
      loaded = true;
      // 已存在的消息以服务端版本为准；只合并明确未发送成功的新消息，不复活已删除会话。
      for (const item of cloud) {
        const pending = new Set(cached?.pendingMessages?.[item.id] || []);
        const local = normalizeConversations(cached?.items).find(current => current.id === item.id);
        const known = new Set(item.messages.map(message => message.id));
        item.messages.push(...(local?.messages || []).filter(message => pending.has(message.id) && !known.has(message.id)));
      }
      const drafts = normalizeConversations(cached?.items).filter(item => cached?.draftIds?.includes(item.id) && !saved.has(item.id));
      return normalizeConversations([...cloud, ...drafts, ...legacy]);
    },
    write(items: VideoWorkbenchConversation[]) {
      const snapshot = structuredClone(items);
      const operation = tail.then(() => sync(snapshot));
      tail = operation.then(() => { failure = undefined; }, error => { failure = error; });
      return operation;
    },
    async flush() { await tail; if (failure) throw failure; },
    isLegacy: (id: string) => legacyIds.has(id),
    async persistAttachment(_messageId: string, attachment: VideoWorkbenchAttachment, file?: File): Promise<VideoWorkbenchAttachment> {
      if (controller.signal.aborted) throw new DOMException("Disposed", "AbortError");
      if (attachment.assetId) return { ...attachment, storageKey: undefined };
      if (!file) throw new Error(`${attachment.name} 缺少本地文件`);
      const asset = await uploadAsset(file, { source_type: "upload", name: attachment.name }, scope, controller.signal);
      return { ...attachment, assetId: asset.id, scope, storageKey: undefined };
    },
    dispose() { controller.abort(); },
  };
}
