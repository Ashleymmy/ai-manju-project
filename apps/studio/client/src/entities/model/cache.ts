import type { QueryClient } from "@tanstack/react-query";

import { modelQueryKeys } from "./queries";

export function invalidateModelCatalog(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: modelQueryKeys.all });
}
