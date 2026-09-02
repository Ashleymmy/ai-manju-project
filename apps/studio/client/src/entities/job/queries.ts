import type { WorkspaceScope } from "@/shared/config";

export type JobListQuery = Record<
  string,
  string | number | boolean | undefined
>;

export function normalizeJobListQuery(query: JobListQuery = {}) {
  const normalizedQuery = { ...query };
  if (
    normalizedQuery.pageSize !== undefined &&
    normalizedQuery.limit === undefined
  ) {
    normalizedQuery.limit = normalizedQuery.pageSize;
  }
  delete normalizedQuery.page;
  delete normalizedQuery.pageSize;
  return normalizedQuery;
}

export const jobQueryKeys = {
  all: ["jobs"] as const,
  lists: () => [...jobQueryKeys.all, "list"] as const,
  listScope: (scope: WorkspaceScope) =>
    [...jobQueryKeys.lists(), scope] as const,
  list: (query: JobListQuery = {}) => {
    const normalizedQuery = normalizeJobListQuery(query);
    const scope =
      normalizedQuery.scope === "personal" || normalizedQuery.scope === "team"
        ? normalizedQuery.scope
        : "personal";
    const filters = { ...normalizedQuery };
    delete filters.scope;
    return [...jobQueryKeys.listScope(scope), filters] as const;
  },
  detail: (jobId: string) => [...jobQueryKeys.all, "detail", jobId] as const,
};
