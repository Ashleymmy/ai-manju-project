import type { ModelCreditPrices } from "@/features/member";
import { request } from "@/shared/api/http";

export function fetchAdminModelPrices() {
  return request<ModelCreditPrices>("/api/admin/billing/model-prices");
}

export function saveAdminModelPrices(value: ModelCreditPrices) {
  return request<{ key: string; value: ModelCreditPrices }>("/api/admin/billing/configs/model_credit_prices", {
    method: "PUT",
    body: { value },
  });
}
