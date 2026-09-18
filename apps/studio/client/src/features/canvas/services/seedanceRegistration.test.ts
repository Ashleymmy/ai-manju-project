// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { getUserSeedanceAsset, uploadUserSeedanceAsset } from "@/entities/asset";
import {
  registerCanvasImageAsset,
  registrationProviderId,
  savedSeedanceRegistration,
  seedanceRegistrationKey,
  seedanceRegistrationPhase,
  seedanceRegistrationSource,
} from "./seedanceRegistration";
import type { CanvasNodeData } from "../domain/types";

vi.mock("@/entities/asset", () => ({ getUserSeedanceAsset: vi.fn(), uploadUserSeedanceAsset: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
const active = { id: "local-official", provider_id: "official", name: "hero", volcano_asset_id: "remote-official", status: "Active", asset_type: "Image" };
const setup = () => ({ scope: "personal" as const, providerId: "official", loadFile: vi.fn(async () => new File(["image"], "hero.png")), onUpdate: vi.fn(async () => {}), onState: vi.fn(), isCurrent: () => true });

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
    expect(options.onState).toHaveBeenNthCalledWith(1, { phase: "processing" });
    expect(options.onState).not.toHaveBeenCalledWith({ phase: "uploading" });
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

describe("canvas real-person asset registration feedback", () => {
  it("keeps registration on moves but resets it for a replacement image or different project", () => {
    const node: CanvasNodeData = { id: "node", kind: "image", content: "", title: "图片", x: 0, y: 0, width: 100, height: 100, imageAssetId: "source-image" };
    node.metadata = { seedanceRegistrationSource: seedanceRegistrationSource(node), seedanceVolcanoAssets: [{ id: "record", volcanoAssetId: "registered", status: "Active" }] };
    expect(savedSeedanceRegistration({ ...node, x: 500 })?.id).toBe("record");
    expect(savedSeedanceRegistration({ ...node, imageAssetId: "new-image" })).toBeUndefined();
    expect(seedanceRegistrationKey("project-a", node)).not.toBe(seedanceRegistrationKey("project-b", node));
  });

  it("shows upload feedback before the request resolves and processing feedback while polling", async () => {
    vi.useFakeTimers();
    const options = setup();
    const pending = { ...active, volcano_asset_id: "", status: "Processing" };
    vi.mocked(uploadUserSeedanceAsset).mockResolvedValue(pending);
    vi.mocked(getUserSeedanceAsset).mockResolvedValue(active);
    const result = registerCanvasImageAsset(options);
    expect(options.onState).toHaveBeenNthCalledWith(1, { phase: "uploading" });
    await vi.advanceTimersByTimeAsync(0);
    expect(options.onState).toHaveBeenCalledWith({ phase: "processing" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await result).toEqual(active);
    expect(options.onUpdate).toHaveBeenLastCalledWith(active);
  });

  it("surfaces provider rejection and permits a fresh upload after failure", async () => {
    vi.useFakeTimers();
    const options = setup();
    const failed = { ...active, volcano_asset_id: "", status: "Failed", error_message: "素材审核未通过" };
    vi.mocked(uploadUserSeedanceAsset).mockResolvedValue(failed);
    const result = registerCanvasImageAsset(options);
    const rejection = expect(result).rejects.toThrow("素材审核未通过");
    await vi.advanceTimersByTimeAsync(0);
    await rejection;
    expect(options.onUpdate).toHaveBeenCalledWith(failed);
    expect(seedanceRegistrationPhase({ ...active, status: "Failed" })).toBe("error");
    // A failed record is not reusable, so a retry uploads again.
    vi.mocked(uploadUserSeedanceAsset).mockResolvedValue(active);
    await expect(registerCanvasImageAsset({ ...options, existing: { id: failed.id, providerId: "official", volcanoAssetId: "", status: "Failed" } })).resolves.toEqual(active);
    expect(uploadUserSeedanceAsset).toHaveBeenCalledTimes(2);
  });

  it("keeps pending status when the provider has not finished after all attempts", async () => {
    vi.useFakeTimers();
    const options = setup();
    const pending = { ...active, volcano_asset_id: "", status: "Processing" };
    vi.mocked(uploadUserSeedanceAsset).mockResolvedValue(pending);
    vi.mocked(getUserSeedanceAsset).mockResolvedValue(pending);
    const result = registerCanvasImageAsset(options);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toEqual(pending);
    expect(seedanceRegistrationPhase(pending)).toBe("pending");
  });

  it("stops polling and skips updates after the project changes", async () => {
    vi.useFakeTimers();
    let current = true;
    const options = { ...setup(), isCurrent: () => current };
    const pending = { ...active, volcano_asset_id: "", status: "Processing" };
    vi.mocked(uploadUserSeedanceAsset).mockResolvedValue(pending);
    vi.mocked(getUserSeedanceAsset).mockResolvedValue(active);
    const result = registerCanvasImageAsset(options);
    await vi.advanceTimersByTimeAsync(0);
    current = false;
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toEqual(pending);
    expect(getUserSeedanceAsset).not.toHaveBeenCalled();
    expect(options.onUpdate).toHaveBeenCalledTimes(1);
  });
});
