import { createContext, useContext } from "react";
import { GenerationPrice } from "@/features/member";
import { canvasImageGenerationSettings } from "../domain/imageGenerationSettings";
import { generationModeFromNode, imageCountFromNode, modelFromNode, promptTextFromNode, videoConfigFromNode } from "../domain/nodeUtils";
import { extractCanvasMentionTokens, type CanvasMentionReference } from "../domain/mentions";
import type { CanvasNodeData, CanvasEdgeData } from "../domain/types";
import { buildCanvasGenerationInputs } from "../domain/connections";
import { canvasSeedanceVideoReferences } from "../domain/video";

/** Default models and reference resolver are the same ones used by canvas submission. */
export const CanvasPricingContext = createContext({ imageModel: "", videoModel: "", nodes: [] as CanvasNodeData[], edges: [] as CanvasEdgeData[], references: (_id: string): CanvasMentionReference[] => [] });

export function CanvasGenerationPrice({ node, edit = false, panorama = false, compact = false }: { node: CanvasNodeData; edit?: boolean; panorama?: boolean; compact?: boolean }) {
  const context = useContext(CanvasPricingContext);
  const mode = edit ? "image" : generationModeFromNode(node);
  const retry = !edit && node.metadata?.status === "error";
  const mentioned = new Set(extractCanvasMentionTokens(promptTextFromNode(node)).map(token => token.key));
  const refs = context.references(node.id).filter(ref => (mentioned.has(ref.key) || (mode === "video" && !mentioned.size && ref.upstreamDistance !== undefined)) && ref.nodeId !== node.id);
  if (mode !== "image" && mode !== "video") return <GenerationPrice kind="free" compact={compact} />;
  if (mode === "video") {
    const config = videoConfigFromNode(node, context.videoModel);
    // Match submission's topology resolution (including config nodes), not all
    // upstream media. Retries prefer current inputs and only then the snapshot.
    const inputs = mentioned.size ? refs.map(ref => ({ type: ref.kind, nodeId: ref.nodeId })) : buildCanvasGenerationInputs(node.id, context.nodes, context.edges);
    const missingMention = [...mentioned].some(key => !refs.some(ref => ref.key === key));
    const useSnapshot = retry && (missingMention || (!inputs.length && !mentioned.size));
    // Older nodes may have persisted their own output as a reference before
    // standalone video retries were fixed. Never charge or submit that stale
    // self-reference; only upstream/current inputs are real references.
    const videoInputs = (useSnapshot ? node.metadata?.videoReferenceInputs?.items ?? [] : inputs)
      .filter(input => input.nodeId !== node.id);
    const registered = canvasSeedanceVideoReferences(node.metadata?.seedanceMaterialAssets, node.metadata?.seedanceVolcanoAssets);
    const referenceVideos = videoInputs.filter(item => item.type === "video").length + registered.videos.length;
    return <GenerationPrice kind="video" model={config.model} seconds={config.seconds} resolution={config.resolution} audio={config.generateAudio} referenceVideos={referenceVideos} compact={compact} />;
  }
  const tasks = retry ? node.metadata?.isBatchRoot
    ? context.nodes.filter(item => (item.id === node.id || node.metadata?.batchChildIds?.includes(item.id)) && item.metadata?.status === "error").length : 1
    : imageCountFromNode(node);
  return <GenerationPrice model={modelFromNode(node, context.imageModel)} {...canvasImageGenerationSettings(node, panorama ? "2:1" : undefined, modelFromNode(node, context.imageModel))} references={edit ? 1 : retry ? node.metadata?.referenceInputs?.length ?? 0 : refs.filter(ref => ref.kind === "image").length} tasks={edit ? 1 : tasks} compact={compact} />;
}
