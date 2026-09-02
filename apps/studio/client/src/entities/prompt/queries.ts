import type { SystemPromptQuery } from "./model";

export const promptQueryKeys = {
  all: ["prompts"] as const,
  list: (page: number, pageSize: number, query: SystemPromptQuery = {}) =>
    [...promptQueryKeys.all, "list", page, pageSize, query] as const,
  completeList: () => [...promptQueryKeys.all, "complete-list"] as const,
};
