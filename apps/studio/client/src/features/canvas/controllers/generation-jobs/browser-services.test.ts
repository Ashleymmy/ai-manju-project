// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserCanvasGenerationServices as services, MEDIA_METADATA_TIMEOUT_MS } from "./browser-services";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("individual local media decoding", () => {
  it.each(["image", "video", "audio"] as const)("releases a stalled %s decoder without hanging preparation", async kind => {
    vi.useFakeTimers();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const file = new File(["fake"], `${kind}.test`, { type: `${kind}/test` });
    const read = { image: services.readImageMetadata, video: services.readVideoMetadata, audio: services.readAudioMetadata }[kind];
    const result = read(file).catch(error => error);
    await vi.advanceTimersByTimeAsync(MEDIA_METADATA_TIMEOUT_MS);
    expect((await result).message).toContain("解析超时");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    expect(vi.getTimerCount()).toBe(0);
  });
});
