import { useCallback, useEffect, useState } from "react";
import { getAssetLibrary, type Asset } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";

// Fetch metadata only. Media remains lazy-loaded by the history dialog.
const HISTORY_PAGE_SIZE = 100;
const EMPTY_ASSETS: Asset[] = [];
export function useCanvasServerVideoHistory(open: boolean, projectId: string | undefined, scope: WorkspaceScope | null | undefined, refreshKey = "") {
  const [attempt, setAttempt] = useState(0);
  const key = open && projectId && scope ? `${scope}:${projectId}` : "";
  const [state, setState] = useState({ key: "", assets: EMPTY_ASSETS, loading: false, error: "" });
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!key || !projectId || !scope) return;
    const controller = new AbortController();
    setState({ key, assets: EMPTY_ASSETS, loading: true, error: "" });
    void (async () => {
      const assets = new Map<string, Asset>();
      let received = 0;
      for (let page = 1; ; page += 1) {
        const result = await getAssetLibrary(scope, {
          sourceProjectId: projectId, type: "video", sort: "created_at_asc", page, pageSize: HISTORY_PAGE_SIZE,
        }, controller.signal);
        if (controller.signal.aborted) return;
        for (const asset of result.items) assets.set(asset.id, asset);
        received += result.items.length;
        const done = result.items.length === 0 || received >= result.total;
        setState({ key, assets: [...assets.values()], loading: !done, error: "" });
        if (done) break;
      }
    })().catch(() => {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, loading: false, error: "服务端视频历史加载失败，请重试" }));
    });
    return () => controller.abort();
  }, [key, projectId, scope, attempt, refreshKey]);
  return { assets: key && state.key === key ? state.assets : EMPTY_ASSETS,
    loading: Boolean(key) && (state.key !== key || state.loading),
    error: key && state.key === key ? state.error : "", retry };
}
