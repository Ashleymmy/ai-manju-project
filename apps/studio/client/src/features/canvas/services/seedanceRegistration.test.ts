// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { getUserSeedanceAsset, uploadUserSeedanceAsset } from "@/entities/asset";
import { registerCanvasImageAsset, registrationProviderId } from "./seedanceRegistration";

vi.mock("@/entities/asset", () => ({ getUserSeedanceAsset: vi.fn(), uploadUserSeedanceAsset: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
const active = { id: "local-official", provider_id: "official", name: "hero", volcano_asset_id: "remote-official", status: "Active", asset_type: "Image" };
const setup = () => ({ scope: "personal" as const, providerId: "official", loadFile: vi.fn(async () => new File(["image"], "hero.png")), onUpdate: vi.fn(async () => {}), isCurrent: () => true });

describe("canvas registration targets", () => {
  it("separates official selectors from managed SD-video slots", () => {
    expect(registrationProviderId("official::ep-1")).toBe("official");
    expect(registrationProviderId("sdvideo/seedance-2-5")).toBeUndefined();
  });
  it("resumes pending registration without another upload", async () => {
    const options = setup();
    vi.mocked(getUserSeedanceAsset).mockResolvedValue(active);
    await registerCanvasImageAsset({ ...options, existing: { id: active.id, volcanoAssetId: "", providerId: "official", status: "Processing" } });
    expect(getUserSeedanceAsset).toHaveBeenCalledWith(active.id, "personal", "official");
    expect(uploadUserSeedanceAsset).not.toHaveBeenCalled();
    expect(options.loadFile).not.toHaveBeenCalled();
    expect(options.onUpdate).toHaveBeenCalledWith(active);
  });
  it("registers the original image for a different provider and persists pending state", async () => {
    vi.useFakeTimers();
    const options = setup();
    const pending = { ...active, volcano_asset_id: "", status: "Processing" };
    vi.mocked(uploadUserSeedanceAsset).mockResolvedValue(pending);
    vi.mocked(getUserSeedanceAsset).mockResolvedValue(active);
    const result = registerCanvasImageAsset({ ...options, existing: { id: "legacy", volcanoAssetId: "old-remote", status: "Active" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(options.onUpdate).toHaveBeenNthCalledWith(1, pending);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await result).toEqual(active);
    expect(uploadUserSeedanceAsset).toHaveBeenCalledTimes(1);
    expect(uploadUserSeedanceAsset).toHaveBeenCalledWith(expect.any(File), "personal", "official");
    expect(options.onUpdate).toHaveBeenLastCalledWith(active);
  });
});
