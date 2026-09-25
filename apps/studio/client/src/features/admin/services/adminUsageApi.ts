import { request } from "@/shared/api/http";

export const COST_MICROS_PER_YUAN = 1_000_000;
export const USAGE_PAGE_SIZE = 20;
export type UsageFilters = { start: string; end: string; user_id?: string; project_id?: string; job_id?: string; model?: string; provider?: string; status?: string; member_kind?: string; task_type?: string; group_by: string; timezone_offset: number; page: number; page_size: number };
export type UsageTotals = { tasks: number; credits_settled: number; credits_frozen: number; succeeded: number; failed: number; estimated_cost_micros: number; actual_cost_micros: number; accounted_cost_micros: number; actual_count: number; estimated_count: number; unknown_cost_count: number };
export type UsageRow = { job_id: string; user_id: string; username: string; display_name: string; project_id: string; project_name: string; workspace_id: string; internal: boolean; task_type: string; model: string; provider: string; status: string; queue_phase?: string; credit_status: string; pending_reason?: string; pending_age_seconds?: number; credits_quoted: number; credits_settled: number; created_at: string; started_at: string | null; finished_at: string | null; settled_at: string | null; attempts: number; estimated_cost_micros: number | null; actual_cost_micros: number | null; cost_reference: string; rate_id: string; cost_unit: string; cost_quantity: number; resolution: string; duration_seconds: number; output_count: number };
export type UsageReport = { items: UsageRow[]; total: number; page: number; page_size: number; stats: UsageTotals; groups: (UsageTotals & { key: string; label: string })[] };
export type CostRate = { id: string; model: string; provider: string; unit: string; unit_cost_micros: number; effective_at: string; created_at: string };
export const getUsageReport = (query: UsageFilters) => request<UsageReport>("/api/admin/billing/usage", { query });
export const exportUsageReport = (query: UsageFilters) => request<{ csv: string; total: number }>("/api/admin/billing/usage", { query: { ...query, export: "csv" }, timeoutMs: 60000 });
export const getCostRates = () => request<CostRate[]>("/api/admin/billing/cost-rates");
export const addCostRate = (body: Omit<CostRate, "id" | "created_at">) => request<CostRate>("/api/admin/billing/cost-rates", { method: "POST", body });
export const saveActualCost = (jobId: string, amountMicros: number, reference: string) => request(`/api/admin/billing/task-costs/${encodeURIComponent(jobId)}`, { method: "PUT", body: { amount_micros: amountMicros, reference } });
export const costMoney = (micros: number | null | undefined) => micros == null ? "待核对" : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micros / COST_MICROS_PER_YUAN);

/** Decimal parsing preserves sub-cent costs and rejects exponent/negative input. */
export function parseCostMicros(value: string): number | null {
  if (!/^\d+(\.\d{1,6})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const amount = Number(whole) * COST_MICROS_PER_YUAN + Number(fraction.padEnd(6, "0"));
  return Number.isSafeInteger(amount) && amount <= 1_000_000_000_000 ? amount : null;
}
