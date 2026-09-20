import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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
import { getJob, isTerminalJob, jobQueryKeys } from "@/entities/job";
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
  const queryClient = useQueryClient();
  // 控制和重试返回的是新状态，initialData 不会更新已有缓存；必须同步才能重新启动轮询。
  useEffect(() => {
    if (batchId && initialData?.batch.id === batchId) {
      const queryKey = comicQueryKeys.batch(scope, batchId);
      if (queryClient.getQueryData(queryKey) === initialData) return;
      // 先取消旧轮询，避免控制/重试前的响应覆盖新状态。
      void queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, initialData);
      void queryClient.invalidateQueries({ queryKey, exact: true });
    }
  }, [queryClient, scope, batchId, initialData]);
  return useQuery({
    enabled: Boolean(batchId),
    queryKey: comicQueryKeys.batch(scope, batchId),
    queryFn: ({ signal }) => getComicBatch(batchId, scope, signal),
    initialData: initialData || undefined,
    refetchOnMount: "always",
    refetchIntervalInBackground: true,
    refetchInterval: query =>
      !query.state.data || isComicBatchActive(query.state.data.batch.status)
        ? COMIC_BATCH_POLL_INTERVAL_MS
        : false,
  });
}

/** 批次记录只保存最终结果；进行中的任务从任务接口读取真实进度。 */
export function useComicBatchItemJobQuery(jobId: string, active: boolean) {
  return useQuery({
    queryKey: jobQueryKeys.detail(jobId),
    queryFn: ({ signal }) => getJob(jobId, signal),
    enabled: Boolean(jobId) && active,
    refetchOnMount: "always",
    refetchIntervalInBackground: true,
    refetchInterval: query =>
      active && (!query.state.data || !isTerminalJob(query.state.data))
        ? COMIC_BATCH_POLL_INTERVAL_MS
        : false,
  });
}
