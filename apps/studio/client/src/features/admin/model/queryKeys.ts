export const adminQueryKeys = {
  all: ["admin"] as const,
  users: () => [...adminQueryKeys.all, "users"] as const,
  providers: () => [...adminQueryKeys.all, "model-providers"] as const,
  providerPresets: () =>
    [...adminQueryKeys.all, "model-provider-presets"] as const,
  monitoring: (hours: number) =>
    [...adminQueryKeys.all, "monitoring", hours] as const,
};
