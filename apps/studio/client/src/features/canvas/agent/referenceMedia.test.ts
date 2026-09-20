// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_BASE_URL } from "@/shared/api/http";
import { buildAgentReferenceContent } from "./referenceMedia";
import type { AgentReference } from "./references";

const reference: AgentReference = { nodeId: "a", title: "Image", kind: "image", mentionKey: "node:a", assetScope: "team" };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Agent reference media", () => {
  it("reads imported data images without attaching API authorization", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) });
    vi.stubGlobal("fetch", fetch);
    const result = await buildAgentReferenceContent("Describe", [{ ...reference, content: "data:image/png;base64,aW1hZ2U=" }], new AbortController().signal);
    expect(fetch.mock.calls[0][1].headers).toBeUndefined();
    expect(result).toContainEqual({ type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } });
  });

  it("recovers API-owned media with credentials and sends bytes, never the private URL", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) });
    vi.stubGlobal("fetch", fetch);
    const content = `${API_BASE_URL}/api/assets/a/content?scope=team`;
    const result = await buildAgentReferenceContent("Describe", [{ ...reference, content }], new AbortController().signal);
    expect(fetch.mock.calls[0][1].credentials).toBe("include");
    expect(JSON.stringify(result)).not.toContain(content);
    expect(result).toContainEqual({ type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } });
  });

  it("never sends API credentials to external image hosts", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) });
    vi.stubGlobal("fetch", fetch);
    await buildAgentReferenceContent("Describe", [{ ...reference, content: "https://images.example.test/ref.png" }], new AbortController().signal);
    expect(fetch.mock.calls[0][1].headers).toBeUndefined();
    expect(fetch.mock.calls[0][1].credentials).toBeUndefined();
  });

  it("rejects HTML responses instead of sending them as pictures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["login"], { type: "text/html" }) }));
    await expect(buildAgentReferenceContent("Describe", [{ ...reference, assetId: "a" }], new AbortController().signal)).rejects.toThrow("图片内容无效");
  });

  it("stops stalled media reads after the bounded timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason)))));
    const assertion = expect(buildAgentReferenceContent("Describe", [{ ...reference, assetId: "a" }], new AbortController().signal)).rejects.toThrow("读取参考图片超时");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});
