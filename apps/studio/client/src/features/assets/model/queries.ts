import { useQuery } from "@tanstack/react-query";

import {
  assetQueryKeys,
  getAsset,
  getAssetFolders,
  getAssetLibrary,
  getAssetLineage,
  getAssetUsageEvents,
  getTrashedAssetLibrary,
  listAssetExports,
  type AssetLibraryQuery,
} from "@/entities/asset";
import {
  getProjects,
  projectQueryKeys,
} from "@/entities/project";
import {
  listAllTags,
  listAssetTagDetails,
  tagQueryKeys,
} from "@/entities/tag";
import type { WorkspaceScope } from "@/shared/config";

type AssetSmartView =
  | "all"
  | "favorite"
  | "dislike"
  | "unused"
  | "frequent"
  | "seedance"
  | "trash";

export const assetFeatureQueryKeys = {
  overview: (scope: WorkspaceScope, revision: number) =>
    [...assetQueryKeys.all, "feature-overview", scope, revision] as const,
};

export function useAssetOverviewQuery(
  scope: WorkspaceScope,
  revision: number
) {
  return useQuery({
    queryKey: assetFeatureQueryKeys.overview(scope, revision),
    queryFn: async () => {
      const [folders, tags] = await Promise.allSettled([
        getAssetFolders(scope),
        listAllTags(scope, "asset"),
      ]);
      return { folders, tags };
    },
  });
}

export function useAssetLibraryPageQuery(
  scope: WorkspaceScope,
  smartView: AssetSmartView,
  query: AssetLibraryQuery,
  revision: number,
  deepLinkAssetId: string
) {
  const queryKey =
    smartView === "trash"
      ? assetQueryKeys.trash(scope, query)
      : assetQueryKeys.library(scope, query);
  return useQuery({
    enabled: smartView !== "seedance",
    queryKey: [...queryKey, "feature-page", smartView, revision] as const,
    queryFn: async ({ signal }) => {
      const result =
        smartView === "trash"
          ? await getTrashedAssetLibrary(scope, query, signal)
          : await getAssetLibrary(scope, query, signal);
      const items = [...(result.items || [])];
      if (
        deepLinkAssetId &&
        !items.some(asset => asset.id === deepLinkAssetId)
      ) {
        try {
          items.unshift(await getAsset(deepLinkAssetId, scope));
        } catch {
          return { ...result, items, deepLinkMissing: true };
        }
      }
      return { ...result, items, deepLinkMissing: false };
    },
  });
}

export function useAssetExportsQuery(
  scope: WorkspaceScope,
  revision: number
) {
  return useQuery({
    queryKey: [
      ...assetQueryKeys.exports(scope),
      "feature-page",
      revision,
    ] as const,
    queryFn: () => listAssetExports(scope),
    refetchInterval: query => {
      const items = query.state.data || [];
      return items.some(
        batch => batch.status === "queued" || batch.status === "running"
      )
        ? 3_000
        : false;
    },
  });
}

export function useAssetLineageQuery(
  scope: WorkspaceScope,
  assetId: string,
  enabled: boolean
) {
  return useQuery({
    enabled: Boolean(assetId) && enabled,
    queryKey: assetQueryKeys.lineage(scope, assetId),
    queryFn: () => getAssetLineage(assetId, scope),
  });
}

export function useAssetUsageQuery(
  scope: WorkspaceScope,
  assetId: string,
  enabled: boolean
) {
  return useQuery({
    enabled: Boolean(assetId) && enabled,
    queryKey: assetQueryKeys.usageEvents(scope, assetId),
    queryFn: () => getAssetUsageEvents(assetId, scope),
  });
}

export function useAssetProjectOptionsQuery(
  scope: WorkspaceScope,
  enabled: boolean
) {
  return useQuery({
    enabled,
    queryKey: [...projectQueryKeys.list(scope), "asset-send-options"] as const,
    queryFn: () => getProjects(scope),
    select: result => (Array.isArray(result) ? result : result.items || []),
  });
}

export function useAssetTagDetailsQuery(
  scope: WorkspaceScope,
  assetId: string,
  externalRevision: number,
  localRevision: number
) {
  return useQuery({
    queryKey: [
      ...tagQueryKeys.assetBindings(scope, assetId),
      externalRevision,
      localRevision,
    ] as const,
    queryFn: ({ signal }) => listAssetTagDetails(scope, assetId, signal),
  });
}
