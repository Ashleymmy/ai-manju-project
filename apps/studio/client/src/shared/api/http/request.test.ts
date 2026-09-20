// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { request } from "./request";

afterEach(() => vi.unstubAllGlobals());

it.each(["<html>504 Gateway Time-out</html>", "Gateway Time-out"])("preserves the HTTP status for a non-JSON gateway response: %s", async (body) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 504, headers: { "X-Request-Id": "gateway-id" } })));
  await expect(request("/api/comic-asset-analysis-sessions")).rejects.toMatchObject({ status: 504, requestId: "gateway-id", message: "请求失败（504）" });
});

it("keeps API error envelopes intact", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, error: "model unavailable" }), { status: 503 })));
  await expect(request("/api/test")).rejects.toMatchObject({ status: 503, message: "model unavailable" });
});
