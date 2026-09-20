// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getAssetLibrary, type AssetLibraryResponse } from "@/entities/asset";
import { useCanvasServerVideoHistory } from "./useCanvasServerVideoHistory";
vi.mock("@/entities/asset", () => ({ getAssetLibrary: vi.fn() }));
let root: ReturnType<typeof createRoot>;
let current: ReturnType<typeof useCanvasServerVideoHistory>;
function Probe({ open, project }: { open: boolean; project: string }) {
  current = useCanvasServerVideoHistory(open, project, "personal"); return null;
}
async function render(open = true, project = "canvas-a") { await act(async () => root.render(<Probe open={open} project={project} />)); }
function page(id: string, number = 1, total = 1): AssetLibraryResponse {
  return { items: [{ id, type: "video", name: id, source_job_id: "job" }], page: number, page_size: 1, total };
}
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.mocked(getAssetLibrary).mockReset(); root = createRoot(document.createElement("div")); });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("loads only when opened and reads every server page including a capped page size", async () => {
  await render(false); expect(getAssetLibrary).not.toHaveBeenCalled();
  vi.mocked(getAssetLibrary).mockResolvedValueOnce(page("old", 1, 2)).mockResolvedValueOnce(page("new", 2, 2));
  await render();
  expect(current.assets.map(asset => asset.id)).toEqual(["old", "new"]);
  expect(current.loading).toBe(false);
  expect(getAssetLibrary).toHaveBeenLastCalledWith("personal", expect.objectContaining({ sourceProjectId: "canvas-a", type: "video", page: 2 }), expect.any(AbortSignal));
});
it("aborts and discards another canvas's late response and hides closed history", async () => {
  let finish!: (page: AssetLibraryResponse) => void;
  vi.mocked(getAssetLibrary).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(page("canvas-b-result"));
  await render(); const signal = vi.mocked(getAssetLibrary).mock.calls[0][2]!;
  await render(true, "canvas-b");
  expect(signal.aborted).toBe(true);
  await act(async () => finish(page("stale")));
  expect(current.assets.map(asset => asset.id)).toEqual(["canvas-b-result"]);
  await render(false, "canvas-b"); expect(current.assets).toEqual([]);
});
it("reports failure while preserving received pages and retries", async () => {
  vi.mocked(getAssetLibrary).mockResolvedValueOnce(page("first", 1, 2)).mockRejectedValueOnce(new Error("network"));
  await render(); expect(current.assets).toHaveLength(1); expect(current.error).toContain("重试");
  vi.mocked(getAssetLibrary).mockResolvedValueOnce(page("retry"));
  await act(async () => current.retry());
  expect(current.assets[0].id).toBe("retry"); expect(current.error).toBe("");
});
