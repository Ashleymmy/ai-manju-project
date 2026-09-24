import { afterEach, expect, it, vi } from "vitest";
import { getProjectSnapshot } from "@/entities/project";
import { readProjectExport } from "./projectExport";

vi.mock("@/entities/project", () => ({ getProjectSnapshot: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const project = { id: "old", title: "旧画布", created_at: "", updated_at: "" };
it("loads the full snapshot on export and preserves both legacy export fields", async () => {
  const data = { nodes: [{ id: "node" }], edges: [], custom: { keep: true } };
  vi.mocked(getProjectSnapshot).mockResolvedValue({ project_id: "old", version: 2, data, created_at: "", updated_at: "" });
  expect(await readProjectExport(project, "team")).toMatchObject({ project: { ...project, data }, snapshot: data });
  expect(getProjectSnapshot).toHaveBeenCalledWith("old", "team");
});
it("refuses to export metadata as an empty canvas when loading fails", async () => {
  vi.mocked(getProjectSnapshot).mockRejectedValue(new Error("timeout"));
  await expect(readProjectExport(project, "personal")).rejects.toThrow("timeout");
});
it.each([null, undefined, "broken", []])("rejects unavailable snapshot data: %j", async data => {
  vi.mocked(getProjectSnapshot).mockResolvedValue({ project_id: "old", version: 2, data, created_at: "", updated_at: "" });
  await expect(readProjectExport(project, "personal")).rejects.toThrow("完整数据不可用");
});
