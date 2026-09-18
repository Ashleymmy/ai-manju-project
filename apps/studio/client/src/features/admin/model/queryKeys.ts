export const adminQueryKeys = {
  all: ["admin"] as const,
  users: () => [...adminQueryKeys.all, "users"] as const,
  providers: () => [...adminQueryKeys.all, "model-providers"] as const,
  providerPresets: () =>
    [...adminQueryKeys.all, "model-provider-presets"] as const,
  monitoring: (hours: number) =>
    [...adminQueryKeys.all, "monitoring", hours] as const,
  /* ---- WP-M7 会员系统后台 8 模块 ---- */
  memberUsers: (page: number) =>
    [...adminQueryKeys.all, "member-users", page] as const,
  billingLedger: (filters: Record<string, string | number | undefined>) =>
    [...adminQueryKeys.all, "billing-ledger", filters] as const,
  billingOrders: (filters: Record<string, string | number | undefined>) =>
    [...adminQueryKeys.all, "billing-orders", filters] as const,
  billingConsumptions: (filters: Record<string, string | number | undefined>) =>
    [...adminQueryKeys.all, "billing-consumptions", filters] as const,
  billingPlans: () => [...adminQueryKeys.all, "billing-plans"] as const,
  billingPackages: () => [...adminQueryKeys.all, "billing-packages"] as const,
  billingConfigs: () => [...adminQueryKeys.all, "billing-configs"] as const,
  billingDashboard: () => [...adminQueryKeys.all, "billing-dashboard"] as const,
  invites: (page: number) => [...adminQueryKeys.all, "invites", page] as const,
  auditLogs: (filters: Record<string, string | number | undefined>) =>
    [...adminQueryKeys.all, "audit-logs", filters] as const,
};
