import type { QueryClient } from "@tanstack/react-query";

import type { WorkspaceScope } from "@/shared/config";

import { tagQueryKeys } from "./queries";

export function invalidateTagScope(
  queryClient: QueryClient,
  scope: WorkspaceScope
) {
  return Promise.all([
    ...(scope === "personal"
      ? [
          queryClient.invalidateQueries({
            queryKey: tagQueryKeys.legacyAssetList(),
          }),
        ]
      : []),
    queryClient.invalidateQueries({
      queryKey: [...tagQueryKeys.all, "list", scope],
    }),
    queryClient.invalidateQueries({
      queryKey: [...tagQueryKeys.all, "complete-list", scope],
    }),
    queryClient.invalidateQueries({
      queryKey: [...tagQueryKeys.all, "prompt-bindings", scope],
    }),
    queryClient.invalidateQueries({
      queryKey: [...tagQueryKeys.all, "asset-bindings", scope],
    }),
  ]);
}
