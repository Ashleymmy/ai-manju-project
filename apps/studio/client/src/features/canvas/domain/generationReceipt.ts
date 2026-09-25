import type { WorkspaceScope } from "@/shared/config";
import type { CanvasAudioGenerationConfig } from "./audioConfig";

/** Saved with the canvas before generation and retained until the result is saved. */
export type CanvasGenerationReceipt = {
  key: string;
  kind: "text" | "audio";
  userId: string;
  scope: WorkspaceScope;
  projectId: string;
  projectKey: string;
  nodeId: string;
  originNodeId: string;
  prompt: string;
  model: string;
  audioConfig?: CanvasAudioGenerationConfig;
};
