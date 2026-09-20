// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiUrl, setAuthToken } from "./http";
import { authenticatedImageSource, recoverAuthenticatedImage } from "./imageRecovery";

const source = apiUrl("/api/assets/image-1/content", { scope: "team", thumbnail: 320 });
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

it("recovers a cookie-less preview with the stored token, retaining thumbnail, scope and cancellation", async () => {
  setAuthToken("test-session", true);
  vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } }));
  const controller = new AbortController();
  const blob = await recoverAuthenticatedImage(source, controller.signal);
  expect(blob.size).toBe(3);
  expect(fetch).toHaveBeenCalledWith(source, {
    credentials: "include", headers: { Authorization: "Bearer test-session" }, cache: "reload", signal: controller.signal,
  });
  expect(source).not.toContain("test-session");
});

it.each([
  "https://untrusted.example/api/assets/image-1/content",
  apiUrl("/api/assets/image-1/metadata"),
  apiUrl("/api/admin/users"),
  "blob:local",
  "data:image/png;base64,AA==",
  "//untrusted.example/api/assets/image-1/content",
  apiUrl("/api/assets/image-1/content").replace("http://", "http://user:password@"),
])("never sends credentials to an unrelated source: %s", async url => {
  expect(authenticatedImageSource(url)).toBeNull();
  await expect(recoverAuthenticatedImage(url, new AbortController().signal)).rejects.toThrow("Unsupported");
  expect(fetch).not.toHaveBeenCalled();
});

it("accepts registered material thumbnails and video posters without changing their queries", () => {
  const registered = apiUrl("/api/sd-video/volcano/assets/registered-1/thumbnail", { scope: "personal" });
  const poster = apiUrl("/api/assets/video-1/content", { scope: "personal", poster: 1 });
  expect(authenticatedImageSource(registered)).toBe(registered);
  expect(authenticatedImageSource(poster)).toBe(poster);
});

it.each([
  [401, "application/json", "{}"],
  [200, "application/json", "{}"],
  [200, "image/png", ""],
])("rejects an invalid response (%s, %s)", async (status, type, body) => {
  vi.mocked(fetch).mockResolvedValue(new Response(body, { status, headers: { "Content-Type": type } }));
  await expect(recoverAuthenticatedImage(source, new AbortController().signal)).rejects.toThrow();
});
