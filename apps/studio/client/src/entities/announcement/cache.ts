import type { QueryClient } from "@tanstack/react-query";

import { announcementQueryKeys } from "./queries";

export function invalidateAnnouncements(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: announcementQueryKeys.all,
  });
}
