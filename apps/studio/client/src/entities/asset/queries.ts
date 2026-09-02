import type { WorkspaceScope } from "@/shared/config";

import type { AssetLibraryQuery, SeedanceAssetListParams } from "./model";

export const assetQueryKeys = {
  all: ["assets"] as const,
  list: (scope: WorkspaceScope) =>
    [...assetQueryKeys.all, "list", scope] as const,
  library: (scope: WorkspaceScope, query: AssetLibraryQuery = {}) =>
    [...assetQueryKeys.all, "library", scope, query] as const,
  trash: (scope: WorkspaceScope, query: AssetLibraryQuery = {}) =>
    [...assetQueryKeys.all, "trash", scope, query] as const,
  detail: (scope: WorkspaceScope, assetId: string) =>
    [...assetQueryKeys.all, "detail", scope, assetId] as const,
  lineage: (scope: WorkspaceScope, assetId: string) =>
    [...assetQueryKeys.all, "lineage", scope, assetId] as const,
  userState: (scope: WorkspaceScope, assetId: string) =>
    [...assetQueryKeys.all, "user-state", scope, assetId] as const,
  usageEvents: (scope: WorkspaceScope, assetId: string) =>
    [...assetQueryKeys.all, "usage-events", scope, assetId] as const,
  folders: (scope: WorkspaceScope) =>
    [...assetQueryKeys.all, "folders", scope] as const,
  exports: (scope: WorkspaceScope) =>
    [...assetQueryKeys.all, "exports", scope] as const,
  exportDetail: (scope: WorkspaceScope, exportId: string) =>
    [...assetQueryKeys.all, "export-detail", scope, exportId] as const,
  tagAssets: (
    scope: WorkspaceScope,
    tagId: string,
    page = 1,
    pageSize = 24
  ) =>
    [
      ...assetQueryKeys.all,
      "tag-assets",
      scope,
      tagId,
      { includeDescendants: true, page, pageSize },
    ] as const,
  seedance: () => [...assetQueryKeys.all, "seedance"] as const,
  seedanceReadiness: () =>
    [...assetQueryKeys.seedance(), "readiness"] as const,
  seedanceAdmin: (params: SeedanceAssetListParams = {}) =>
    [...assetQueryKeys.seedance(), "admin", "list", params] as const,
  seedanceAdminDetail: (assetId: string) =>
    [...assetQueryKeys.seedance(), "admin", "detail", assetId] as const,
  seedanceMentions: (params: SeedanceAssetListParams = {}) =>
    [...assetQueryKeys.seedance(), "mentions", params] as const,
  seedanceTags: () => [...assetQueryKeys.seedance(), "tags"] as const,
};
