import { useQuery } from "@tanstack/react-query";

import {
  assetQueryKeys,
  listTagAssets,
} from "@/entities/asset";
import {
  listAllTags,
  listTagPrompts,
  tagQueryKeys,
} from "@/entities/tag";
import type { WorkspaceScope } from "@/shared/config";

export function useTagLibraryQuery(scope: WorkspaceScope) {
  return useQuery({
    queryKey: tagQueryKeys.completeList(scope),
    queryFn: () => listAllTags(scope),
  });
}

export function useTagPromptBindingsQuery(
  scope: WorkspaceScope,
  tagId: string,
  enabled: boolean
) {
  return useQuery({
    enabled: Boolean(tagId) && enabled,
    queryKey: tagQueryKeys.promptBindings(scope, tagId, true),
    queryFn: ({ signal }) => listTagPrompts(scope, tagId, true, signal),
  });
}

export function useTagAssetsQuery(
  scope: WorkspaceScope,
  tagId: string,
  page: number
) {
  return useQuery({
    enabled: Boolean(tagId),
    queryKey: assetQueryKeys.tagAssets(scope, tagId, page, 24),
    queryFn: ({ signal }) => listTagAssets(scope, tagId, page, 24, signal),
  });
}
