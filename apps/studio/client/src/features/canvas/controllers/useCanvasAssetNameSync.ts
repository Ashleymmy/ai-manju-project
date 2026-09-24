import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateAssetRecord, subscribeAssetNameChanges } from "@/entities/asset";
import { useCanvasStore, useCanvasStoreApi } from "../ui/CanvasProvider";
import { canvasNodeAssetNameTarget, syncCanvasNodeAssetName } from "../services/assetNames";

/** Observe final title transactions, including attachment, renumbering and undo.
 * Hydration waits for a matching catalog record before reconciling older names. */
export function useCanvasAssetNameSync(userId: string, projectId: string, catalog: readonly { id: string; name: string; scope: "personal" | "team" }[] = []) {
  const store = useCanvasStoreApi();
  const loading = useCanvasStore(state => state.session.loading);
  const reconciled = useRef(new Set<string>());
  const queryClient = useQueryClient();
  useEffect(() => subscribeAssetNameChanges(message => {
    if (!message.assetId.startsWith("local-text:")) void invalidateAssetRecord(queryClient, message.scope, message.assetId);
  }), [queryClient]);
  useEffect(() => {
    let active = true;
    const unsubscribe = store.subscribe((state, previous) => {
      const scope = state.session.canonicalProjectScope;
      if (!userId || !projectId || !scope || state.session.loading || previous.session.loading
        || state.session.switching || previous.session.switching || scope !== previous.session.canonicalProjectScope
        || state.graph.nodes === previous.graph.nodes) return;
      const context = { userId, projectId, scope };
      const oldNodes = new Map(previous.graph.nodes.map(node => [node.id, node]));
      for (const node of state.graph.nodes) {
        const old = oldNodes.get(node.id);
        const target = canvasNodeAssetNameTarget(node, context);
        if (!target) continue;
        const oldTarget = old && canvasNodeAssetNameTarget(old, context);
        const attached = target.key !== oldTarget?.key;
        if (!attached && old?.title === node.title) continue;
        // Import/generation attaches media before the store assigns its final
        // numbered title. Sync that final title, without renaming a reused file
        // merely because a second node references it.
        if (attached && state.graph.nodes.filter(item => canvasNodeAssetNameTarget(item, context)?.key === target.key).length !== 1) continue;
        const sync = () => syncCanvasNodeAssetName(node, context).catch(() => {
          // An obsolete failure must not invite retrying an old title.
          const current = store.getState().graph.nodes.find(item => item.id === node.id);
          if (!active || current?.title !== node.title || canvasNodeAssetNameTarget(current, context)?.key !== target.key) return;
          toast.error(`“${node.title}”已在画布改名，但素材库名称同步失败`, { action: { label: "重试", onClick: () => {
            const latest = store.getState().graph.nodes.find(item => item.id === node.id);
            if (active && latest?.title === node.title && canvasNodeAssetNameTarget(latest, context)?.key === target.key) void sync();
          } } });
        });
        void sync();
      }
    });
    return () => { active = false; unsubscribe(); };
  }, [store, userId, projectId]);

  useEffect(() => {
    const state = store.getState();
    const scope = state.session.canonicalProjectScope;
    if (!userId || !projectId || !scope || loading || state.session.switching) return;
    const context = { userId, projectId, scope };
    for (const asset of catalog) {
      const matches = state.graph.nodes.filter(node => {
        const target = canvasNodeAssetNameTarget(node, context);
        return target && !target.text && target.id === asset.id && target.scope === asset.scope;
      });
      if (matches.length !== 1) continue;
      const node = matches[0];
      const key = `${userId}:${projectId}:${asset.scope}:${asset.id}`;
      if (reconciled.current.has(key)) continue;
      reconciled.current.add(key);
      // Heal older uploads whose names were saved before collision numbering.
      // Do this once per asset/session, so later external edits do not loop.
      if (asset.name !== node.title) {
        void syncCanvasNodeAssetName(node, context).catch(() => {
          reconciled.current.delete(key);
          toast.error(`“${node.title}”的素材名称同步失败，请重新打开素材列表重试`);
        });
      }
    }
  }, [catalog, loading, projectId, store, userId]);
}
