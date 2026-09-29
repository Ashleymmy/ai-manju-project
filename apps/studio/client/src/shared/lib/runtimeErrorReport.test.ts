// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  reportRuntimeError,
  reportRequestFailure,
  safeRuntimeText,
  setRuntimeErrorOwner,
} from "./runtimeErrorReport";
const fetchMock = vi.fn();
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("ai-manju:auth_token", "test");
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  setRuntimeErrorOwner("alice");
});
afterEach(() => {
  setRuntimeErrorOwner("");
  vi.unstubAllGlobals();
});
it("redacts credentials, URLs and media before transmission", () => {
  for (const value of [
    "Authorization: Bearer SECRET123",
    '{"password":"SECRET123"}',
    "https://u:SECRET123@host/path?token=SECRET123",
    "sk-SECRET123",
    "data:image/png;base64,SECRET123",
  ])
    expect(safeRuntimeText(value)).not.toContain("SECRET123");
});
it("deduplicates errors and excludes HTTP failures and aborts", () => {
  reportRuntimeError(new Error("render failed"));
  reportRuntimeError(new Error("render failed"));
  reportRuntimeError(new DOMException("cancel", "AbortError"));
  reportRuntimeError({ status: 502 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("never sends stale-session errors or anonymous errors", () => {
  localStorage.setItem("ai-manju:auth_token", "changed");
  reportRuntimeError("old session error");
  expect(fetchMock).not.toHaveBeenCalled();
  setRuntimeErrorOwner("");
  reportRuntimeError("anonymous");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("does not recurse when reporting fails", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  reportRuntimeError("first error");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("reports the failing API and measured diagnostic instead of the current page", () => {
  reportRequestFailure({
    path: "/api/member/pricing",
    method: "GET",
    requestId: "original-id",
    httpStatus: 0,
    durationMs: 15003,
    message: "请求超时",
    diagnostics: {
      stage: "request_timeout",
      page_path: "/member/plans",
      exception_name: "AbortError",
      exception_message: "aborted token=SECRET",
      stack: "at request",
      timeout_ms: 15000,
      response_received: false,
    },
  });
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body).toMatchObject({
    endpoint: "/api/member/pricing",
    request_id: "original-id",
    duration_ms: 15003,
    method: "GET",
    diagnostics: {
      page_path: "/member/plans",
      exception_name: "AbortError",
      response_received: false,
    },
  });
  expect(JSON.stringify(body)).not.toContain("SECRET");
  reportRuntimeError({ runtimeReported: true, status: 0 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
