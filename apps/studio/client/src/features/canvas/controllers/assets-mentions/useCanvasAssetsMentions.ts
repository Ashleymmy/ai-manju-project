import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CanvasNodeData } from "@/features/canvas/domain/types";
import { assetIdFromNode } from "@/features/canvas/domain/nodes";
import { mediaKindFromNode } from "@/features/canvas/domain/nodeUtils";
import { workspaceScopeValue } from "@/features/canvas/domain/workspace";
import { CanvasAssetsMentionsController } from "./controller";
import type { CanvasAssetsMentionsBindings } from "./types";

type CanvasAssetsMentionsHookInput = CanvasAssetsMentionsBindings & {
  projectId: string;
  canonicalScope: "personal" | "team" | null;
  fallbackScope: "personal" | "team";
  mentionScope: "personal" | "team";
  nodes: CanvasNodeData[];
};

export function useCanvasAssetsMentions(input: CanvasAssetsMentionsHookInput) {
  const [controller] = useState(
    () => new CanvasAssetsMentionsController(input.fallbackScope),
  );
  controller.updateBindings(input);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const previewSignature = useMemo(
    () => canvasPreviewAssetSignature(input.nodes, input.canonicalScope, input.fallbackScope),
    [input.canonicalScope, input.fallbackScope, input.nodes],
  );

  useEffect(() => {
    if (input.projectId && !input.canonicalScope) return;
    void controller.loadMentionCatalog("", input.mentionScope);
  }, [controller, input.canonicalScope, input.mentionScope, input.projectId]);

  useEffect(() => {
    void controller.syncNodePreviews({
      projectId: input.projectId,
      canonicalScope: input.canonicalScope,
      fallbackScope: input.fallbackScope,
    });
  }, [controller, input.canonicalScope, input.fallbackScope, input.projectId, previewSignature]);

  useEffect(() => () => controller.dispose(), [controller]);

  return { controller, snapshot };
}

export function canvasPreviewAssetSignature(
  nodes: CanvasNodeData[],
  canonicalScope: "personal" | "team" | null,
  fallbackScope: "personal" | "team",
) {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const id = assetIdFromNode(node);
    if (!id) continue;
    const scope = workspaceScopeValue(node.metadata?.assetScope) || canonicalScope || fallbackScope;
    const key = `${scope}:${mediaKindFromNode(node)}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys.sort().join("|");
}
