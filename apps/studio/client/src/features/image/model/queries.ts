import { useQuery } from "@tanstack/react-query";

import {
  assetQueryKeys,
  getAssetLibrary,
} from "@/entities/asset";
import { modelQueryKeys } from "@/entities/model";
import type { WorkspaceScope } from "@/shared/config";

import { fetchImageModels } from "../api";

const historyQuery = {
  sourceType: "image_workbench" as const,
  sort: "created_at_desc" as const,
  page: 1,
  pageSize: 12,
};

export function useImageModelCatalogQuery() {
  return useQuery({
    queryKey: modelQueryKeys.capability("image", {
      normalizeMetadata: false,
    }),
    queryFn: fetchImageModels,
  });
}

export function useImageHistoryQuery(scope: WorkspaceScope) {
  return useQuery({
    queryKey: assetQueryKeys.library(scope, historyQuery),
    queryFn: ({ signal }) => getAssetLibrary(scope, historyQuery, signal),
  });
}

export function useImageAssetPickerQuery(
  scope: WorkspaceScope,
  keyword: string,
  enabled: boolean
) {
  const query = {
    keyword: keyword.trim() || undefined,
    sort: "created_at_desc" as const,
    page: 1,
    pageSize: 12,
  };
  return useQuery({
    enabled,
    queryKey: [
      ...assetQueryKeys.library(scope, query),
      "image-reference-picker",
    ] as const,
    queryFn: ({ signal }) => getAssetLibrary(scope, query, signal),
    select: result =>
      (result.items || []).filter(asset => asset.type === "image"),
  });
}
