import type { QueryClient } from "@tanstack/react-query";

import type { AuthUser } from "./model";
import { authQueryKeys } from "./queries";

export function setCurrentAuthUser(
  queryClient: QueryClient,
  user: AuthUser | null
) {
  queryClient.setQueryData(authQueryKeys.currentUser(), user);
}

export function clearAuthCache(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: authQueryKeys.all });
}
