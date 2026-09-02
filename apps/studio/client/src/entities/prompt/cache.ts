import type { QueryClient } from "@tanstack/react-query";

import { promptQueryKeys } from "./queries";

export function invalidatePromptLibrary(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: promptQueryKeys.all });
}
