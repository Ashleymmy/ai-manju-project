import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CanvasNodeData } from "@/features/canvas/domain/types";
import { collectCanvasPreviewAssetRefs } from "@/features/canvas/domain/generationHistory";
import { workspaceScopeValue } from "@/features/canvas/domain/workspace";
import { syncCanvasTextAssets } from "@/features/canvas/repositories/textAssetsRepository";
import { CanvasAssetsMentionsController } from "./controller";
import type { CanvasAssetsMentionsBindings } from "./types";

type CanvasAssetsMentionsHookInput = CanvasAssetsMentionsBindings & {
  projectId: string;
  canonicalScope: "personal" | "team" | null;
  fallbackScope: "personal" | "team";
  mentionScope: "personal" | "team";
  nodes: CanvasNodeData[];
};

// Save after typing settles; moving a node must not trigger another write.
const TEXT_ASSET_SAVE_DELAY_MS = 600;

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
  const userId = input.getUserId();
  const textSignature = useMemo(() => JSON.stringify(input.nodes.filter(node => node.kind === "text")
    .map(node => [node.id, node.title, node.content, node.metadata?.content, node.metadata?.status,
      node.metadata?.textAssetId, node.metadata?.textAssetScope])), [input.nodes]);

  useEffect(() => {
    if (!input.projectId || !input.canonicalScope || !userId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void syncCanvasTextAssets({ userId, scope: input.canonicalScope!, projectId: input.projectId, nodes: input.getNodes() })
        .then(changed => {
          if (!changed || cancelled) return;
          const library = controller.getSnapshot().mentionLibrary;
          void controller.loadMentionCatalog(library.query, input.mentionScope, library.target);
        }).catch(error => console.warn("自动保存画布文本素材失败", error));
    }, TEXT_ASSET_SAVE_DELAY_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [controller, userId, input.projectId, input.canonicalScope, input.mentionScope, textSignature]);

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
  for (const ref of collectCanvasPreviewAssetRefs(nodes)) {
    const scope = workspaceScopeValue(ref.scope) || canonicalScope || fallbackScope;
    const key = `${scope}:${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys.sort().join("|");
}
