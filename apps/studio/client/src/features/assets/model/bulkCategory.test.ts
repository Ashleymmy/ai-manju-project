import { describe, expect, it, vi } from "vitest";
import { updateAssetMetadata, type Asset } from "@/entities/asset";
import { updateAssetCategories } from "./bulkCategory";

vi.mock("@/entities/asset", () => ({ updateAssetMetadata: vi.fn() }));

describe("bulk asset category updates", () => {
  it("updates only the requested field, deduplicates IDs and retains partial results", async () => {
    vi.mocked(updateAssetMetadata).mockReset().mockImplementation(async (id, data) => {
      if (id === "b") throw new Error("offline");
      return { id, name: "unchanged.png", category: data.category } as Asset;
    });
    const result = await updateAssetCategories(["a", "b", "a", "c"], "environment", "team");
    expect(result.updated.map(asset => asset.id).sort()).toEqual(["a", "c"]);
    expect(result.failedIds).toEqual(["b"]);
    expect(updateAssetMetadata).toHaveBeenCalledTimes(3);
    for (const id of ["a", "b", "c"]) expect(updateAssetMetadata).toHaveBeenCalledWith(id, { category: "environment" }, "team");
    vi.mocked(updateAssetMetadata).mockResolvedValue({ id: "b", category: "environment" } as Asset);
    await updateAssetCategories(result.failedIds, "environment", "team");
    expect(updateAssetMetadata).toHaveBeenCalledTimes(4);
    expect(updateAssetMetadata).toHaveBeenLastCalledWith("b", { category: "environment" }, "team");
  });

  it("bounds in-flight requests and finishes the remaining assets after a failure", async () => {
    let inFlight = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    vi.mocked(updateAssetMetadata).mockReset().mockImplementation(async id => {
      peak = Math.max(peak, ++inFlight);
      await new Promise<void>(resolve => releases.push(resolve));
      inFlight--;
      if (id === "b") throw new Error("offline");
      return { id } as Asset;
    });
    const saving = updateAssetCategories(["a", "b", "c", "d", "e"], "prop", "personal");
    expect(updateAssetMetadata).toHaveBeenCalledTimes(3);
    while (releases.length) {
      releases.splice(0).forEach(release => release());
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const result = await saving;
    expect(peak).toBe(3);
    expect(result.updated).toHaveLength(4);
    expect(result.failedIds).toEqual(["b"]);
  });
});
