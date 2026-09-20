import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas-agent";
import { buildCanvasMentionReferences, extractCanvasMentionTokens } from "../domain/mentions";

export type AgentReference = {
  nodeId: string;
  title: string;
  kind: string;
  mentionKey?: string;
  assetId?: string;
  assetScope: "personal" | "team";
  content?: string;
  text?: string;
};

export function canvasAgentReferences(snapshot: CanvasAgentSnapshot, scope: "personal" | "team"): AgentReference[] {
  const mentions = buildCanvasMentionReferences("", snapshot.nodes.map(node => ({ ...node, kind: node.kind || node.type })), [], [], scope);
  const byId = new Map(mentions.map(reference => [reference.nodeId, reference]));
  return snapshot.nodes.map(node => {
    const reference = byId.get(node.id);
    return {
      nodeId: node.id,
      title: node.title?.trim() || node.id,
      kind: reference?.kind || node.kind || node.type,
      mentionKey: reference?.key,
      assetId: reference?.assetId,
      assetScope: reference?.assetScope || scope,
      content: reference?.content,
      text: reference?.text,
    };
  });
}

export function describeAgentReferences(references: readonly AgentReference[]) {
  return references.length ? `\n\n本次引用：\n${references.map(reference =>
    `${reference.title} (${reference.kind}) @[node:${reference.nodeId}]${reference.text ? `\n${reference.text}` : ""}`
  ).join("\n")}\n生成时沿用这些引用；图片和视频使用新的生成节点，不覆盖引用源。` : "";
}

/** Keep media bytes out of localStorage; asset IDs are sufficient for history previews. */
export function persistableAgentReferences(references: readonly AgentReference[]) {
  return references.map(({ content: _content, text: _text, ...reference }) => reference);
}

function composerPrompt(metadata?: Record<string, unknown>, fallback = "") {
  return [metadata?.composerContent, metadata?.prompt, fallback].find((value): value is string => typeof value === "string" && Boolean(value.trim())) || "";
}

/** Use the same @ tokens as the node editor, even when the model omits referenceNodeIds. */
export function applyAgentReferencesToOps(ops: CanvasAgentOp[], references: readonly AgentReference[], snapshot: CanvasAgentSnapshot): CanvasAgentOp[] {
  const usable = references.filter(reference => reference.mentionKey);
  if (!usable.length) return ops;
  const staged = applyCanvasAgentOps(snapshot, ops);
  const stagedReferences = new Map(canvasAgentReferences(staged, "personal").map(reference => [reference.nodeId, reference]));
  const withReferences = (prompt: string, targetId?: string) => {
    for (const reference of usable) {
      const current = stagedReferences.get(reference.nodeId);
      if (!current) throw new Error(`引用节点“${reference.title}”已删除，请重新选择后发送。`);
      if (reference.kind !== "text" && (current.kind !== reference.kind || current.assetId !== reference.assetId || !reference.assetId && current.content !== reference.content)) {
        throw new Error(`引用素材“${reference.title}”已变化，请重新确认引用后发送。`);
      }
      if (reference.nodeId === targetId) throw new Error(`不能覆盖本次引用源“${reference.title}”，请使用新的生成节点。`);
    }
    const existing = new Set(extractCanvasMentionTokens(prompt).map(token => token.key));
    return [prompt, ...usable.filter(reference => !existing.has(reference.mentionKey!)).map(reference => `@[${reference.mentionKey}]`)].filter(Boolean).join("\n");
  };
  return ops.map(op => {
    if (op.type === "add_node" && op.nodeType === "config") {
      const prompt = withReferences(composerPrompt(op.metadata), op.id);
      return { ...op, metadata: { ...op.metadata, prompt, composerContent: prompt } };
    }
    if (op.type === "run_generation") {
      const target = staged.nodes.find(node => node.id === op.nodeId);
      return { ...op, prompt: withReferences(op.prompt?.trim() || composerPrompt(target?.metadata, target?.content), op.nodeId) };
    }
    return op;
  });
}
