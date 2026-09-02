import { useQuery } from "@tanstack/react-query";

import {
  fetchModelCatalog,
  modelQueryKeys,
} from "@/entities/model";

import { getPreferences } from "../api";

export const settingsQueryKeys = {
  all: ["settings"] as const,
  preferences: () => [...settingsQueryKeys.all, "preferences"] as const,
};

export function usePreferencesQuery() {
  return useQuery({
    queryKey: settingsQueryKeys.preferences(),
    queryFn: getPreferences,
  });
}

export function useModelCatalogQuery() {
  return useQuery({
    queryKey: modelQueryKeys.catalog(),
    queryFn: fetchModelCatalog,
  });
}
