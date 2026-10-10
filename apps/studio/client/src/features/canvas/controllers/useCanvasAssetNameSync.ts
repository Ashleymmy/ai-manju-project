import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAssetRecord, subscribeAssetNameChanges } from "@/entities/asset";
import { ApiError } from "@/shared/api/errors";
import { useCanvasStore, useCanvasStoreApi } from "../ui/CanvasProvider";
import type { CanvasStoreApi } from "../model/store";
import type { CanvasNodeData } from "../domain/types";
import {
  canvasNodeAssetNameTarget,
  pendingCanvasAssetNames,
  syncCanvasNodeAssetName,
  type CanvasAssetNameContext,
} from "../services/assetNames";

/** Silent retries after a failed library rename, covering brief network or server hiccups. */
export const ASSET_NAME_SYNC_RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;
/** The library refuses these on every retry (invalid name, asset gone or not ours), so stop trying. */
const ASSET_NAME_SYNC_PERMANENT_STATUSES = new Set([400, 403, 404, 410, 422]);

type AssetNameSyncOptions = { remember: boolean; onGiveUp?: () => void };
type AssetNameSyncRunner = {
  run: (node: CanvasNodeData, targetKey: string, context: CanvasAssetNameContext, options: AssetNameSyncOptions) => void;
  active: () => boolean;
  dispose: () => void;
};

function hydratedCanvas(state: ReturnType<CanvasStoreApi["getState"]>) {
  return Boolean(state.session.canonicalProjectScope) && !state.session.loading && !state.session.switching;
}

/** Only the first node in graph order names a shared asset; a stale owner must not write. */
function currentAssetNameOwner(store: CanvasStoreApi, nodeId: string, targetKey: string, context: CanvasAssetNameContext) {
  const { session, graph } = store.getState();
  if (session.loading || session.switching || session.canonicalProjectScope !== context.scope) return;
  const owner = graph.nodes.find(node => canvasNodeAssetNameTarget(node, context)?.key === targetKey);
  return owner?.id === nodeId ? owner : undefined;
}

function createAssetNameSyncRunner(store: CanvasStoreApi): AssetNameSyncRunner {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;
  const clearTimer = (key: string) => {
    clearTimeout(timers.get(key));
    timers.delete(key);
  };
  const run = (node: CanvasNodeData, targetKey: string, context: CanvasAssetNameContext, options: AssetNameSyncOptions, attempt = 0) => {
    clearTimer(targetKey);
    void syncCanvasNodeAssetName(node, context).then(() => {
      if (options.remember) void pendingCanvasAssetNames.forget(context, targetKey);
    }, (error: unknown) => {
      if (error instanceof ApiError && ASSET_NAME_SYNC_PERMANENT_STATUSES.has(error.status)) {
        if (options.remember) void pendingCanvasAssetNames.forget(context, targetKey);
        return;
      }
      // A newer title or owner runs its own sync; never retry an obsolete name.
      if (!disposed && currentAssetNameOwner(store, node.id, targetKey, context)?.title !== node.title) return;
      if (options.remember) void pendingCanvasAssetNames.remember(context, targetKey, node);
      if (disposed) return;
      const delay = ASSET_NAME_SYNC_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        options.onGiveUp?.();
        return;
      }
      clearTimer(targetKey);
      timers.set(targetKey, setTimeout(() => {
        timers.delete(targetKey);
        const latest = currentAssetNameOwner(store, node.id, targetKey, context);
        if (!disposed && latest?.title === node.title) run(latest, targetKey, context, options, attempt + 1);
      }, delay));
    });
  };
  return {
    run: (node, targetKey, context, options) => run(node, targetKey, context, options),
    active: () => !disposed,
    dispose: () => {
      disposed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

/** Observe final title transactions, including attachment, renumbering and undo.
 * Hydration waits for a matching catalog record before reconciling older names.
 * Failures retry silently and resume on the next open of this canvas. */
export function useCanvasAssetNameSync(userId: string, projectId: string, catalog: readonly { id: string; name: string; scope: "personal" | "team" }[] = []) {
  const store = useCanvasStoreApi();
  const loading = useCanvasStore(state => state.session.loading);
  const reconciled = useRef(new Set<string>());
  const resumed = useRef(false);
  const runner = useRef<AssetNameSyncRunner | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => subscribeAssetNameChanges(message => {
    if (!message.assetId.startsWith("local-text:")) void invalidateAssetRecord(queryClient, message.scope, message.assetId);
  }), [queryClient]);
  useEffect(() => {
    const sync = createAssetNameSyncRunner(store);
    runner.current = sync;
    const resume = () => {
      const scope = store.getState().session.canonicalProjectScope;
      if (!userId || !projectId || !scope) return;
      const context = { userId, projectId, scope };
      void pendingCanvasAssetNames.list(context).then(pending => {
        for (const item of pending) {
          if (!sync.active() || !hydratedCanvas(store.getState())) return;
          const owner = currentAssetNameOwner(store, item.nodeId, item.targetKey, context);
          // Renamed, deleted or handed to another node since: that change already synced its own name.
          if (owner?.title === item.title) sync.run(owner, item.targetKey, context, { remember: true });
          else void pendingCanvasAssetNames.forget(context, item.targetKey);
        }
      });
    };
    // Before the first load the store still holds the previous canvas, so resume
    // only once this canvas finishes hydrating (or is already hydrated on mount).
    if (!resumed.current && hydratedCanvas(store.getState())) resume();
    resumed.current = true;
    const unsubscribe = store.subscribe((state, previous) => {
      if (hydratedCanvas(state) && !hydratedCanvas(previous)) resume();
      const scope = state.session.canonicalProjectScope;
      if (!userId || !projectId || !scope || state.session.loading || previous.session.loading
        || state.session.switching || previous.session.switching || scope !== previous.session.canonicalProjectScope
        || state.graph.nodes === previous.graph.nodes) return;
      const context = { userId, projectId, scope };
      const oldNodes = new Map(previous.graph.nodes.map(node => [node.id, node]));
      const targets = state.graph.nodes.map(node => canvasNodeAssetNameTarget(node, context));
      // Copies share their source's media; only the first node in graph order
      // names it, so a copy's own name and collision number stay on the canvas.
      const ownerByKey = new Map<string, string>();
      const referencesByKey = new Map<string, number>();
      targets.forEach((target, index) => {
        if (!target) return;
        if (!ownerByKey.has(target.key)) ownerByKey.set(target.key, state.graph.nodes[index].id);
        referencesByKey.set(target.key, (referencesByKey.get(target.key) || 0) + 1);
      });
      for (const [index, node] of state.graph.nodes.entries()) {
        const old = oldNodes.get(node.id);
        const target = targets[index];
        if (!target || ownerByKey.get(target.key) !== node.id) continue;
        const oldTarget = old && canvasNodeAssetNameTarget(old, context);
        const attached = target.key !== oldTarget?.key;
        if (!attached && old?.title === node.title) continue;
        // Import/generation attaches media before the store assigns its final
        // numbered title. Sync that final title, without renaming a reused file
        // merely because a second node references it.
        if (attached && referencesByKey.get(target.key) !== 1) continue;
        sync.run(node, target.key, context, { remember: true });
      }
    });
    return () => {
      unsubscribe();
      sync.dispose();
      if (runner.current === sync) runner.current = null;
    };
  }, [store, userId, projectId]);

  useEffect(() => {
    const state = store.getState();
    const scope = state.session.canonicalProjectScope;
    const sync = runner.current;
    if (!sync || !userId || !projectId || !scope || loading || state.session.switching) return;
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
      const target = canvasNodeAssetNameTarget(node, context);
      if (target && asset.name !== node.title) {
        sync.run(node, target.key, context, { remember: false, onGiveUp: () => reconciled.current.delete(key) });
      }
    }
  }, [catalog, loading, projectId, store, userId]);
}
