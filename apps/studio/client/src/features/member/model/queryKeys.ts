export const memberQueryKeys = {
  all: ["member"] as const,
  overview: () => [...memberQueryKeys.all, "overview"] as const,
  ledger: (entryType: string, page: number) =>
    [...memberQueryKeys.all, "ledger", entryType, page] as const,
  consumptions: (status: string, page: number) =>
    [...memberQueryKeys.all, "consumptions", status, page] as const,
  invite: () => [...memberQueryKeys.all, "invite"] as const,
  gifts: () => [...memberQueryKeys.all, "gifts"] as const,
  pricing: () => [...memberQueryKeys.all, "pricing"] as const,
  orders: () => [...memberQueryKeys.all, "orders"] as const,
};
