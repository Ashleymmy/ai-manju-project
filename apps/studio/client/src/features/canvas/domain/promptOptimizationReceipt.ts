import type { WorkspaceScope } from "@/shared/config";

/** Separate from generationReceipt: recovering an edit never changes node kind. */
export type CanvasPromptOptimizationReceipt = {
  version: 1;
  key: string;
  userId: string;
  scope: WorkspaceScope;
  projectId: string;
  projectKey: string;
  nodeId: string;
  /** Original node kind, used only to fence automatic prompt replacement. */
  kind: string;
  prompt: string;
  model: string;
  state: "pending" | "received" | "failed";
  result?: string;
  applied?: boolean;
};

export function validPromptOptimizationReceipt(value: CanvasPromptOptimizationReceipt) {
  return value?.version === 1 && typeof value.key === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(value.key)
    && typeof value.kind === "string" && Boolean(value.kind)
    && typeof value.prompt === "string" && typeof value.model === "string" && Boolean(value.model.trim())
    && ["pending", "received", "failed"].includes(value.state)
    && (value.applied === undefined || typeof value.applied === "boolean")
    && (value.state !== "received" || (typeof value.result === "string" && Boolean(value.result.trim())));
}
