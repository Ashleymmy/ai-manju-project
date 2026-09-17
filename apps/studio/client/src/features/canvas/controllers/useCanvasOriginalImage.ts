import { useCallback, useEffect, useState } from "react";
import { getAssetContentBlob } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";
import { assetIdFromNode, imageSrcFromNode } from "../domain/nodes";
import type { CanvasNodeData } from "../domain/types";
import { workspaceScopeValue } from "../domain/workspace";

type OriginalImage = { key: string; source: string; bytes?: number; loading: boolean; error: string };

/** Own only the open detail image, never reuse or overwrite the canvas thumbnail cache. */
export function useCanvasOriginalImage(node: CanvasNodeData | undefined, fallbackScope: WorkspaceScope) {
  const assetId = node ? assetIdFromNode(node) : "";
  const directSource = node ? imageSrcFromNode(node, {}) : "";
  const scope = workspaceScopeValue(node?.metadata?.assetScope) || fallbackScope;
  const key = JSON.stringify([node?.id, assetId, scope, directSource]);
  const [result, setResult] = useState<OriginalImage | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const hasNode = Boolean(node);

  useEffect(() => {
    if (!hasNode) {
      setResult(null);
      return;
    }
    const abort = new AbortController();
    let ownedUrl = "";
    setResult({ key, source: "", loading: true, error: "" });
    const load = async () => {
      try {
        let blob: Blob;
        if (assetId) {
          // No thumbnail parameter: the asset service returns the original file.
          blob = await getAssetContentBlob(assetId, scope, undefined, abort.signal);
        } else {
          if (!directSource) throw new Error("missing original");
          const response = await fetch(directSource, { signal: abort.signal });
          if (!response.ok) throw new Error("original unavailable");
          blob = await response.blob();
        }
        if (abort.signal.aborted) return;
        ownedUrl = URL.createObjectURL(blob);
        setResult({ key, source: ownedUrl, bytes: blob.size, loading: false, error: "" });
      } catch {
        if (abort.signal.aborted) return;
        // Legacy external URLs may display as an image while denying cross-origin byte reads.
        // Show their original directly, but never invent a file size or use a cached thumbnail.
        setResult({ key, source: assetId ? "" : directSource, bytes: undefined, loading: false,
          error: assetId || !directSource ? "原图加载失败，请重试" : "" });
      }
    };
    void load();
    return () => {
      abort.abort();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [key, hasNode, assetId, directSource, scope, attempt]);

  return {
    ...(result?.key === key ? result : { source: "", bytes: undefined, loading: hasNode, error: "" }),
    retry,
  };
}
