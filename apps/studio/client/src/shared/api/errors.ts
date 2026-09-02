import { ApiError } from "./http";

export function publicApiError(error: unknown, fallback = "请求失败") {
  if (error instanceof ApiError) {
    return `${error.message}${error.requestId ? `（request_id: ${error.requestId}）` : ""}`;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
