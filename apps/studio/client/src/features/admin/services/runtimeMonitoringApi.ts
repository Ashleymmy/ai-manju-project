import { request } from "@/shared/api/http";

// Shared page and refresh bounds for the runtime monitoring views.
export const MONITORING_PAGE_SIZE = 30;
export const MONITORING_REFRESH_MS = 15_000;
export const MONITORING_HOUR_MS = 3_600_000;
export type MonitoringFilters = {
  start: string;
  end: string;
  user_id: string;
  source: string;
  status: string;
  code: string;
  model: string;
  q: string;
  page: number;
  page_size: number;
};
export type MonitoringRow = {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  source: string;
  status: string;
  request_id: string;
  job_id: string;
  project_id: string;
  node_id: string;
  operation: string;
  model: string;
  endpoint: string;
  method: string;
  http_status: number;
  provider_status: number;
  duration_ms: number;
  error_code: string;
  message: string;
  detail: string;
  suggestion: string;
  attempt: number;
  max_attempts: number;
  retryable: boolean;
  created_at: string;
  provider?: string;
};
export type MonitoringReport = {
  generated_at: string;
  start: string;
  end: string;
  is_global: boolean;
  can_view_all: boolean;
  user_id: string;
  items: MonitoringRow[];
  total: number;
  page: number;
  page_size: number;
  stats: {
    records: number;
    errors: number;
    successes: number;
    pending: number;
    canceled: number;
    affected_users: number;
    average_duration_ms: number;
  };
  buckets: { bucket: string; records: number; errors: number }[];
  codes: { key: string; count: number }[];
  sources: { key: string; count: number }[];
};
export type MonitoringUser = {
  id: string;
  username: string;
  display_name: string;
};
export const getRuntimeMonitoring = (
  filters: MonitoringFilters,
  signal?: AbortSignal
) => request<MonitoringReport>("/api/monitoring", { query: filters, signal });
export const getMonitoringUsers = (signal?: AbortSignal) =>
  request<MonitoringUser[]>("/api/monitoring/users", { signal });
export const exportMonitoring = (filters: MonitoringFilters) =>
  request<{ csv: string; total: number }>("/api/monitoring", {
    query: { ...filters, export: "csv" },
  });
