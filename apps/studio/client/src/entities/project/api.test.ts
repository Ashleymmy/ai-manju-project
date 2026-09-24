import { afterEach, expect, it, vi } from "vitest";
import { request } from "@/shared/api/http";
import { getProjectSummaries } from "./api";

vi.mock("@/shared/api/http", () => ({ request: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it("requests metadata with cancellation and strips full data from older servers", async () => {
  const signal = new AbortController().signal;
  vi.mocked(request).mockResolvedValue({ items: [{ id: "old", title: "旧画布", data: { nodes: [1] } }], total: 1 });
  expect(await getProjectSummaries("team", signal)).toEqual([{ id: "old", title: "旧画布" }]);
  expect(request).toHaveBeenCalledWith("/api/projects", { query: { scope: "team", include_data: false }, signal });
});
it.each([undefined, null, {}, "gateway error", { items: null }, [null], [{ id: "a" }]])("rejects malformed lists instead of showing an empty workspace (%j)", async result => {
  vi.mocked(request).mockResolvedValue(result);
  await expect(getProjectSummaries()).rejects.toThrow("画布列表返回异常");
});
it("accepts successful empty and array lists", async () => {
  vi.mocked(request).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "a", title: "画布" }]);
  expect(await getProjectSummaries()).toEqual([]);
  expect(await getProjectSummaries()).toEqual([{ id: "a", title: "画布" }]);
});
