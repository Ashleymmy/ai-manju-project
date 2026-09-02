import type { QueryClient } from "@tanstack/react-query";

import type { WorkspaceScope } from "@/shared/config";

import type { Asset } from "./model";
import { assetQueryKeys } from "./queries";

export function invalidateAssetScope(
  queryClient: QueryClient,
  scope: WorkspaceScope
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: assetQueryKeys.list(scope),
    }),
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.all, "library", scope],
    }),
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.all, "trash", scope],
    }),
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.all, "detail", scope],
    }),
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.all, "lineage", scope],
    }),
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.all, "user-state", scope],
    }),
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.all, "usage-events", scope],
    }),
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.all, "tag-assets", scope],
    }),
    queryClient.invalidateQueries({
      queryKey: assetQueryKeys.folders(scope),
    }),
    queryClient.invalidateQueries({
      queryKey: assetQueryKeys.exports(scope),
    }),
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.all, "export-detail", scope],
    }),
  ]);
}

export function invalidateAssetRecord(
  queryClient: QueryClient,
  scope: WorkspaceScope,
  assetId: string
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: assetQueryKeys.detail(scope, assetId),
    }),
    queryClient.invalidateQueries({
      queryKey: assetQueryKeys.lineage(scope, assetId),
    }),
    queryClient.invalidateQueries({
      queryKey: assetQueryKeys.userState(scope, assetId),
    }),
    queryClient.invalidateQueries({
      queryKey: assetQueryKeys.usageEvents(scope, assetId),
    }),
    queryClient.invalidateQueries({
      queryKey: assetQueryKeys.list(scope),
    }),
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.all, "library", scope],
    }),
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.all, "trash", scope],
    }),
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.all, "tag-assets", scope],
    }),
  ]);
}

export function invalidateAssetExports(
  queryClient: QueryClient,
  scope: WorkspaceScope,
  exportId?: string
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: assetQueryKeys.exports(scope),
    }),
    queryClient.invalidateQueries({
      queryKey: exportId
        ? assetQueryKeys.exportDetail(scope, exportId)
        : [...assetQueryKeys.all, "export-detail", scope],
    }),
  ]);
}

export function invalidateSeedanceAssets(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: assetQueryKeys.seedance(),
  });
}

export function invalidateSeedanceAsset(
  queryClient: QueryClient,
  assetId: string
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.seedance(), "admin", "list"],
    }),
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.seedance(), "mentions"],
    }),
    queryClient.invalidateQueries({
      queryKey: assetQueryKeys.seedanceAdminDetail(assetId),
    }),
  ]);
}

export function invalidateSeedanceTags(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: assetQueryKeys.seedanceTags(),
    }),
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.seedance(), "admin"],
    }),
    queryClient.invalidateQueries({
      queryKey: [...assetQueryKeys.seedance(), "mentions"],
    }),
  ]);
}

export function setAssetCache(
  queryClient: QueryClient,
  scope: WorkspaceScope,
  asset: Asset
) {
  queryClient.setQueryData(assetQueryKeys.detail(scope, asset.id), asset);
}
