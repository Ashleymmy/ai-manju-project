import { useQuery } from "@tanstack/react-query";

import {
  assetQueryKeys,
  getAssetFolders,
  getAssetLibrary,
} from "@/entities/asset";
import {
  comicQueryKeys,
  getComicBatch,
  listComicProjects,
  type ComicBatchDetail,
} from "@/entities/comic";
import {
  fetchImageModelCatalog,
  fetchTextModelCatalog,
  modelQueryKeys,
} from "@/entities/model";
import type { WorkspaceScope } from "@/shared/config";

import { COMIC_BATCH_POLL_INTERVAL_MS } from "./constants";
import { isComicBatchActive } from "./workflow";

export function useComicProjectsQuery(scope: WorkspaceScope) {
  return useQuery({
    queryKey: comicQueryKeys.projects(scope),
    queryFn: () => listComicProjects(scope),
    placeholderData: previous => previous,
  });
}

export function useComicTextModelsQuery() {
  return useQuery({
    queryKey: modelQueryKeys.capability("text", {
      includeGenericModels: false,
      normalizeMetadata: false,
    }),
    queryFn: () =>
      fetchTextModelCatalog({
        includeGenericModels: false,
        normalizeMetadata: false,
      }),
  });
}

export function useComicImageModelsQuery() {
  return useQuery({
    queryKey: modelQueryKeys.capability("image", {
      normalizeMetadata: false,
    }),
    queryFn: () => fetchImageModelCatalog({ normalizeMetadata: false }),
  });
}

export function useComicFoldersQuery(scope: WorkspaceScope) {
  return useQuery({
    queryKey: [...assetQueryKeys.folders(scope), "comic-destination"] as const,
    queryFn: () => getAssetFolders(scope),
    placeholderData: previous => previous,
  });
}

export function useComicReferenceAssetsQuery(
  scope: WorkspaceScope,
  keyword: string,
  enabled: boolean
) {
  const query = {
    keyword: keyword.trim() || undefined,
    sort: "created_at_desc" as const,
    page: 1,
    pageSize: 10,
  };
  return useQuery({
    enabled,
    queryKey: [
      ...assetQueryKeys.library(scope, query),
      "comic-reference-picker",
    ] as const,
    queryFn: ({ signal }) => getAssetLibrary(scope, query, signal),
    placeholderData: previous => previous,
    select: result =>
      (result.items || []).filter(asset => asset.type === "image"),
  });
}

export function useComicBatchQuery(
  scope: WorkspaceScope,
  batchId: string,
  initialData: ComicBatchDetail | null
) {
  return useQuery({
    enabled: Boolean(batchId),
    queryKey: comicQueryKeys.batch(scope, batchId),
    queryFn: () => getComicBatch(batchId, scope),
    initialData: initialData || undefined,
    refetchOnMount: false,
    refetchInterval: query =>
      isComicBatchActive(query.state.data?.batch.status)
        ? COMIC_BATCH_POLL_INTERVAL_MS
        : false,
  });
}
