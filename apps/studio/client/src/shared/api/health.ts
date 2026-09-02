import { request } from "./http";

export type HealthStatus = {
  public_signup?: boolean;
  status?: string;
};

export function getHealth() {
  return request<HealthStatus>("/health", { timeoutMs: 5_000 });
}
