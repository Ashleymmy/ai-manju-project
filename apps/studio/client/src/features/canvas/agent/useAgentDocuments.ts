import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AGENT_DOCUMENT_LIMITS, type AgentDocument, type AgentDocumentDraft } from "./documents";
import { readAgentDocument } from "./readDocument";

export function useAgentDocuments(sessionKey: string) {
  const [drafts, setDrafts] = useState<AgentDocumentDraft[]>([]);
  const current = useRef(drafts);
  const pending = useRef(new Map<string, AbortController>());
  const update = (next: AgentDocumentDraft[]) => { current.current = next; setDrafts(next); };
  const clear = () => {
    for (const controller of pending.current.values()) controller.abort();
    pending.current.clear();
    update([]);
  };
  useEffect(() => {
    clear();
    return () => {
      for (const controller of pending.current.values()) controller.abort();
      pending.current.clear();
    };
  }, [sessionKey]);
  const remove = (id: string) => {
    pending.current.get(id)?.abort();
    pending.current.delete(id);
    update(current.current.filter(file => file.id !== id));
  };
  const add = async (files: File[]) => {
    if (current.current.length + files.length > AGENT_DOCUMENT_LIMITS.files) {
      toast.error("每条消息最多附加 5 个文件，请移除部分附件后重试");
      return;
    }
    const items = files.map(file => ({ file, id: crypto.randomUUID(), controller: new AbortController() }));
    for (const item of items) pending.current.set(item.id, item.controller);
    update([...current.current, ...items.map(({ file, id }): AgentDocumentDraft => ({ id, name: file.name, size: file.size, status: "reading" }))]);
    for (const { file, id, controller } of items) {
      try {
        const text = await readAgentDocument(file, controller.signal);
        if (controller.signal.aborted) continue;
        const total = current.current.reduce((sum, draft) => sum + (draft.text?.length || 0), 0);
        if (total + text.length > AGENT_DOCUMENT_LIMITS.totalChars) throw new Error("本条消息附件合计超过 120,000 字符，请分批发送");
        update(current.current.map(draft => draft.id === id ? { ...draft, status: "ready", text } : draft));
      } catch (error) {
        if (!controller.signal.aborted) update(current.current.map(draft => draft.id === id ? { ...draft, status: "error", error: error instanceof Error ? error.message : "读取失败" } : draft));
      } finally {
        pending.current.delete(id);
      }
    }
  };
  const documents: AgentDocument[] = drafts.flatMap(draft => draft.status === "ready" ? [{ id: draft.id, name: draft.name, size: draft.size, text: draft.text! }] : []);
  return { drafts, documents, blocked: drafts.some(draft => draft.status !== "ready"), add, remove, clear };
}
