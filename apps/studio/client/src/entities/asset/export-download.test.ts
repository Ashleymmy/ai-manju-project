// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { startAssetExportDownload } from "./api";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("starts a native authenticated download without allocating a Blob or leaking a token", async () => {
  const blob = vi.fn();
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, blob });
  vi.stubGlobal("fetch", fetch);
  let clicked: HTMLAnchorElement | undefined;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function(this: HTMLAnchorElement) { clicked = this; });
  await startAssetExportDownload("export-id", "personal");
  expect(String(fetch.mock.calls[0][0])).toContain("/api/asset-exports/export-id/content?scope=personal");
  expect(fetch.mock.calls[0][1]).toEqual({ method: "HEAD", credentials: "include" });
  expect(blob).not.toHaveBeenCalled();
  expect(clicked?.download).toBe("");
  expect(clicked?.href).not.toMatch(/token|authorization/i);
  expect(document.querySelector("a")).toBeNull();
});

it.each([[401, "重新登录"], [410, "已过期"], [409, "暂时无法下载"]])("does not start an unavailable download (%s)", async (status, message) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await expect(startAssetExportDownload("id")).rejects.toThrow(String(message));
  expect(click).not.toHaveBeenCalled();
});
