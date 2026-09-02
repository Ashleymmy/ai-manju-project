import { useQuery } from "@tanstack/react-query";

import { getHealth } from "@/shared/api/health";

export const authFeatureQueryKeys = {
  health: () => ["auth", "public-health"] as const,
};

export function usePublicHealthQuery() {
  return useQuery({
    queryKey: authFeatureQueryKeys.health(),
    queryFn: getHealth,
  });
}
