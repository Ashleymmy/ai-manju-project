import type { WorkspaceScope } from "@/shared/config";

export type AgentConversationOwner = { userId: string; projectId: string; scope: WorkspaceScope };

/** Only recovery identity is retained here, never the media-bearing request. */
export type AgentTextReceipt = AgentConversationOwner & {
  version: 1;
  key: string;
  conversationId: string;
  model: string;
  state: "pending" | "received" | "failed";
  tools?: "suggested" | "started" | "finished";
};

export function agentConversationScopeKey(owner: AgentConversationOwner) {
  return `v2:${encodeURIComponent(owner.userId)}:${owner.scope}:${encodeURIComponent(owner.projectId)}`;
}

export function ownsAgentTextReceipt(receipt: AgentTextReceipt | undefined, owner: AgentConversationOwner, conversationId: string) {
  return Boolean(owner.userId && receipt?.version === 1 && typeof receipt.model === "string" && receipt.model.trim()
    && ["pending", "received", "failed"].includes(receipt.state)
    && (receipt.tools === undefined || ["suggested", "started", "finished"].includes(receipt.tools))
    && (receipt.scope === "personal" || receipt.scope === "team") && receipt.userId === owner.userId
    && receipt.projectId === owner.projectId && receipt.scope === owner.scope
    && receipt.conversationId === conversationId && typeof receipt.key === "string"
    && /^[a-zA-Z0-9._:-]{1,128}$/.test(receipt.key));
}
