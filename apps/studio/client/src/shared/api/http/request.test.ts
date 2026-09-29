// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { request } from "./request";
import { REQUEST_FAILURE_EVENT } from "../../lib/requestDiagnostics";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(["<html>504 Gateway Time-out</html>", "Gateway Time-out"])(
  "preserves the HTTP status for a non-JSON gateway response: %s",
  async body => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 504,
          headers: { "X-Request-Id": "gateway-id" },
        })
      )
    );
    await expect(
      request("/api/comic-asset-analysis-sessions")
    ).rejects.toMatchObject({
      status: 504,
      requestId: "gateway-id",
      message: "请求失败（504）",
    });
  }
);

it("keeps API error envelopes intact", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, error: "model unavailable" }),
          { status: 503 }
        )
      )
  );
  await expect(request("/api/test")).rejects.toMatchObject({
    status: 503,
    message: "model unavailable",
  });
});

it("captures original transport failure, endpoint, method and request ID", async () => {
  const dispatch = vi.spyOn(window, "dispatchEvent");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
  );
  await expect(
    request("/api/member/pricing?token=SECRET", {
      method: "POST",
      headers: { "X-Request-Id": "original" },
    })
  ).rejects.toMatchObject({ status: 0, runtimeReported: true });
  const event = dispatch.mock.calls.find(
    ([e]) => e.type === REQUEST_FAILURE_EVENT
  )?.[0] as CustomEvent;
  expect(event.detail).toMatchObject({
    path: "/api/member/pricing",
    method: "POST",
    requestId: "original",
    httpStatus: 0,
    diagnostics: {
      stage: "request_transport",
      response_received: false,
      exception_name: "TypeError",
      exception_message: "Failed to fetch",
    },
  });
  expect(event.detail.durationMs).toBeGreaterThanOrEqual(0);
});

it("distinguishes timeout from an explicit cancel", async () => {
  vi.useFakeTimers();
  const dispatch = vi.spyOn(window, "dispatchEvent");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          )
        )
    )
  );
  const result = expect(
    request("/api/slow", { timeoutMs: 1500 })
  ).rejects.toMatchObject({ message: "请求超时或已取消" });
  await vi.advanceTimersByTimeAsync(1500);
  await result;
  const event = dispatch.mock.calls.find(
    ([e]) => e.type === REQUEST_FAILURE_EVENT
  )?.[0] as CustomEvent;
  expect(event.detail.diagnostics).toMatchObject({
    stage: "request_timeout",
    timeout_ms: 1500,
    response_received: false,
  });
  dispatch.mockClear();
  const controller = new AbortController();
  const canceled = expect(
    request("/api/slow", { signal: controller.signal })
  ).rejects.toMatchObject({ message: "请求超时或已取消" });
  controller.abort();
  await canceled;
  expect(dispatch).not.toHaveBeenCalled();
});

it("records actual gateway body and retains status when response reading fails", async () => {
  const dispatch = vi.spyOn(window, "dispatchEvent");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(new Response("upstream timed out", { status: 504 }))
  );
  await expect(request("/api/test")).rejects.toMatchObject({ status: 504 });
  expect(
    (dispatch.mock.calls[0][0] as CustomEvent).detail.diagnostics
  ).toMatchObject({
    stage: "gateway_response",
    response_received: true,
    response_body: "upstream timed out",
  });
  dispatch.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: 502,
      headers: new Headers(),
      text: () => Promise.reject(new TypeError("terminated")),
    })
  );
  await expect(request("/api/test")).rejects.toMatchObject({ status: 502 });
  expect(
    (dispatch.mock.calls[0][0] as CustomEvent).detail.diagnostics
  ).toMatchObject({
    stage: "response_read",
    response_received: true,
    exception_message: "terminated",
  });
});

it("reads object error messages and the original envelope request ID", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: "bad_request", message: "actual message" },
          request_id: "server-id",
        }),
        { status: 400 }
      )
    )
  );
  await expect(request("/api/test")).rejects.toMatchObject({
    message: "actual message",
    requestId: "server-id",
  });
});
