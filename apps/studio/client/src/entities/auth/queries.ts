export const authQueryKeys = {
  all: ["auth"] as const,
  currentUser: () => [...authQueryKeys.all, "current-user"] as const,
};
