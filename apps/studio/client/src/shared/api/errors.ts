import { toast } from "sonner";

import { ApiError } from "./http";

export { ApiError };

export function publicApiError(error: unknown, fallback = "请求失败") {
  if (error instanceof ApiError) {
    return `${error.message}${error.requestId ? `（request_id: ${error.requestId}）` : ""}`;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 是否为积分不足（HTTP 402，后端统一文案「积分余额不足，请充值后重试」）。 */
export function isInsufficientCreditsError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 402;
}

/**
 * 生成类错误的统一提示：402 时附「去充值」动作按钮跳套餐购买页，
 * 其他错误沿用普通错误文案。
 */
export function toastGenerationError(
  error: unknown,
  fallback: string,
  onRecharge: () => void
) {
  if (isInsufficientCreditsError(error)) {
    toast.error(publicApiError(error, "积分余额不足"), {
      action: { label: "去充值", onClick: onRecharge },
    });
    return;
  }
  toast.error(publicApiError(error, fallback));
}
