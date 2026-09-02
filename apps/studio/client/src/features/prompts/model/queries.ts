import { useQuery } from "@tanstack/react-query";

import {
  getPromptLibrary,
  promptQueryKeys,
} from "@/entities/prompt";
import {
  listAllTags,
  tagQueryKeys,
} from "@/entities/tag";

export function usePromptSemanticTagsQuery() {
  return useQuery({
    queryKey: tagQueryKeys.completeList("personal", "prompt"),
    queryFn: () => listAllTags("personal", "prompt"),
  });
}

export function useSystemPromptLibraryQuery(
  enabled: boolean,
  page: number,
  keyword: string,
  category: string,
  tags: string[]
) {
  const query = {
    keyword: keyword || undefined,
    category: category || undefined,
    tags,
  };
  return useQuery({
    enabled,
    queryKey: promptQueryKeys.list(page, 20, query),
    queryFn: () => getPromptLibrary(page, 20, query),
  });
}
