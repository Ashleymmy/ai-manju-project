import type { WorkspaceScope } from "@/shared/config";

export type TagListQuery = {
  usage?: "asset" | "prompt";
  keyword?: string;
  includeDescendants?: boolean;
  page?: number;
  pageSize?: number;
};

export const tagQueryKeys = {
  all: ["tags"] as const,
  legacyAssetList: () =>
    [...tagQueryKeys.all, "legacy-asset-list"] as const,
  list: (scope: WorkspaceScope, query: TagListQuery = {}) =>
    [...tagQueryKeys.all, "list", scope, query] as const,
  completeList: (
    scope: WorkspaceScope,
    usage?: "asset" | "prompt"
  ) => [...tagQueryKeys.all, "complete-list", scope, { usage }] as const,
  promptBindings: (
    scope: WorkspaceScope,
    tagId: string,
    includeDescendants = true
  ) =>
    [
      ...tagQueryKeys.all,
      "prompt-bindings",
      scope,
      tagId,
      { includeDescendants },
    ] as const,
  assetBindings: (scope: WorkspaceScope, assetId: string) =>
    [...tagQueryKeys.all, "asset-bindings", scope, assetId] as const,
};
