import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  audioFileName,
  normalizeAudioGenerationConfig,
  requestAudioGeneration,
} from "./audio";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("audio API", () => {
  const dispatchEvent = vi.fn();

  beforeEach(() => {
    dispatchEvent.mockReset();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      dispatchEvent,
    });
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes the production voice, format and speed limits", () => {
    expect(
      normalizeAudioGenerationConfig({
        model: " provider::tts-v1 ",
        voice: "unknown",
        format: "unknown",
        speed: "9.25",
        instructions: "  轻声朗读  ",
      })
    ).toEqual({
      model: "provider::tts-v1",
      voice: "alloy",
      format: "mp3",
      speed: "4",
      instructions: "轻声朗读",
    });
    expect(
      normalizeAudioGenerationConfig({ model: "tts", speed: "0.1" }).speed
    ).toBe("0.25");
    expect(audioFileName("旁白", "wav")).toBe("旁白.wav");
  });

  it("submits the production speech payload without stripping the provider selector", async () => {
    localStorage.setItem("ai-manju:auth_token", "token-value");
    localStorage.setItem("ai-manju:token-store", "local");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(new Blob(["audio"], { type: "audio/mpeg" }), {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "X-Request-Id": "audio-request",
        },
      })
    );

    const blob = await requestAudioGeneration(
      {
        model: "provider::tts-v1",
        voice: "coral",
        format: "mp3",
        speed: "1.25",
        instructions: "温和、自然",
      },
      "欢迎使用画布"
    );

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(new URL(url).pathname).toBe("/api/ai/audio/speech");
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-value"
    );
    expect(
      (options.headers as Record<string, string>)["X-Request-Id"]
    ).toBeTruthy();
    expect(JSON.parse(String(options.body))).toEqual({
      model: "provider::tts-v1",
      input: "欢迎使用画布",
      voice: "coral",
      response_format: "mp3",
      speed: 1.25,
      instructions: "温和、自然",
    });
    expect(blob.type).toBe("audio/mpeg");
  });

  it("repairs a generic binary MIME type using the requested format", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(new Blob(["wav"], { type: "application/octet-stream" }), {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      })
    );

    const blob = await requestAudioGeneration(
      { model: "tts", format: "wav" },
      "测试音频"
    );

    expect(blob.type).toBe("audio/wav");
  });

  it("surfaces JSON provider errors and the public 429 fallback", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "provider rejected" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        })
      );

    await expect(
      requestAudioGeneration({ model: "tts" }, "失败一")
    ).rejects.toMatchObject({
      name: "ApiError",
      message: "provider rejected",
      status: 200,
    });
    await expect(
      requestAudioGeneration({ model: "tts" }, "失败二")
    ).rejects.toMatchObject({
      name: "ApiError",
      message: "请求被限流或额度不足，请稍后重试",
      status: 429,
    });
  });

  it("clears authentication and emits the shared unauthorized event on 401", async () => {
    localStorage.setItem("ai-manju:auth_token", "expired-token");
    localStorage.setItem("ai-manju:token-store", "local");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(
      requestAudioGeneration({ model: "tts" }, "登录测试")
    ).rejects.toMatchObject({ status: 401 });
    expect(localStorage.getItem("ai-manju:auth_token")).toBeNull();
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });

  it("forwards AbortSignal and stops the in-flight request", async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );

    const result = requestAudioGeneration({ model: "tts" }, "取消测试", {
      signal: controller.signal,
    });
    controller.abort();

    await expect(result).rejects.toMatchObject({
      name: "ApiError",
      message: "请求超时或已取消",
      status: 0,
    });
  });
});
