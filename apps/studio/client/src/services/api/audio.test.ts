import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  audioFileName,
  audioVoiceOptions,
  audioVoiceOptionsForModel,
  clonedVoiceLabel,
  normalizeAudioGenerationConfig,
  requestAudioGeneration,
  deriveVoiceClonePrefix,
  voiceCloneFileProblem,
  voiceCloneNameProblem,
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

  it("does not restart receipt recovery after an accepted submission's missing result", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 202 }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 404 }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await expect(requestAudioGeneration({ model: "tts" }, "文本", { receipt: { key: "accepted-audio" } }))
      .rejects.toMatchObject({ status: 404 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/audio/speech"))).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/reconcile"))).toHaveLength(1);
  });

  it("keeps the original reason and request ID once the receipt confirms the failure", async () => {
    const json = { "Content-Type": "application/json" };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ success: false, error: "请求过于频繁，请稍后重试" }), {
      status: 502, headers: { ...json, "X-Request-Id": "req-original" },
    }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      success: false, error: "生成失败，请查看原任务状态",
      data: { receipt: { kind: "audio", key: "failed-audio", status: "failed" } },
    }), { status: 502, headers: json }));
    const failure = await requestAudioGeneration({ model: "tts" }, "文本", { receipt: { key: "failed-audio" } }).catch(error => error);
    expect(failure).toMatchObject({ message: "请求过于频繁，请稍后重试", requestId: "req-original" });
    expect(failure.details?.data?.receipt?.status).toBe("failed");
  });

  it("offers CosyVoice only its own clones and system voices", () => {
    const clones = [
      { value: "cosyvoice-v3.5-plus-role01-abc", label: "复刻 A" },
      { value: "cosyvoice-v3-flash-role02-def", label: "复刻 B" },
      ...audioVoiceOptions,
    ];
    const values = audioVoiceOptionsForModel("bailian::cosyvoice-v3.5-plus", clones).map(item => item.value);
    expect(values).toContain("cosyvoice-v3.5-plus-role01-abc");
    expect(values).not.toContain("cosyvoice-v3-flash-role02-def");
    expect(values).not.toContain("alloy");
    expect(values).toContain("longanyang");
    expect(audioVoiceOptionsForModel("tts-1", clones).map(item => item.value)).toContain("alloy");
  });

  it("only sends formats and instructions the CosyVoice voice supports", () => {
    const cosy = "bailian::cosyvoice-v3.5-plus";
    expect(normalizeAudioGenerationConfig({ model: cosy, format: "flac" }).format).toBe("mp3");
    expect(normalizeAudioGenerationConfig({ model: cosy, format: "wav" }).format).toBe("wav");
    expect(normalizeAudioGenerationConfig({ model: "tts-1", format: "flac" }).format).toBe("flac");
    expect(normalizeAudioGenerationConfig({ model: cosy, voice: "longwan_v3", instructions: "请用河南话表达" }).instructions).toBe("");
    expect(normalizeAudioGenerationConfig({ model: cosy, voice: "longanhuan_v3", instructions: "请用河南话表达" }).instructions).toBe("请用河南话表达");
  });

  it("recovers exact speech bytes after a lost response using a GET, never a second POST", async () => {
    const bytes = new Uint8Array([0, 1, 255, 44]);
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("lost response"));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(bytes, { headers: { "Content-Type": "audio/wav" } }));
    const blob = await requestAudioGeneration({ model: "tts", format: "wav" }, "文本", {
      receipt: { key: "original-audio", scope: "team" },
    });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(blob.type).toBe("audio/wav");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe("POST");
    expect(vi.mocked(fetch).mock.calls[1][1]?.method).not.toBe("POST");
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain("/receipts/audio/original-audio/result?scope=team");
  });

  it.each([
    ["", "audio/mpeg"],
    ["<html>login</html>", "text/html"],
    ["<!DOCTYPE html><html>gateway error</html>", "application/octet-stream"],
    ['{"success":true,"task_id":"not-audio"}', "application/json"],
  ])("rejects non-audio success bodies with MIME %s / %s", async (body, contentType) => {
    vi.mocked(fetch).mockResolvedValue(new Response(body, { status: 200, headers: { "Content-Type": contentType } }));
    await expect(requestAudioGeneration({ model: "tts" }, "测试")).rejects.toMatchObject({ name: "ApiError", message: "音频服务没有返回可用音频，请联系管理员检查模型配置" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

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

describe("voiceCloneFileProblem", () => {
  const mb = 1024 * 1024;

  it("tells the user how to fix CosyVoice reference audio", () => {
    const model = "cosyvoice-v3.5-plus";
    expect(voiceCloneFileProblem({ name: "a.ogg", size: mb }, 15, model)).toContain("格式");
    expect(voiceCloneFileProblem({ name: "a.mp3", size: 11 * mb }, 15, model)).toContain("10 MB");
    expect(voiceCloneFileProblem({ name: "a.mp3", size: mb }, 4, model)).toContain("5 秒");
    expect(voiceCloneFileProblem({ name: "a.mp3", size: mb }, 61, model)).toContain("60 秒");
    expect(voiceCloneFileProblem({ name: "a.WAV", size: mb }, 15, model)).toBe("");
    expect(voiceCloneFileProblem({ name: "a.m4a", size: mb }, undefined, model)).toBe("");
  });

  it("applies the MiniMax limits", () => {
    const model = "MiniMax/speech-02-hd";
    expect(voiceCloneFileProblem({ name: "a.mp3", size: 15 * mb }, 30, model)).toBe("");
    expect(voiceCloneFileProblem({ name: "a.mp3", size: 21 * mb }, 30, model)).toContain("20 MB");
    expect(voiceCloneFileProblem({ name: "a.mp3", size: mb }, 8, model)).toContain("10 秒");
    expect(voiceCloneFileProblem({ name: "a.mp3", size: mb }, 120, model)).toBe("");
    expect(voiceCloneFileProblem({ name: "a.mp3", size: mb }, 301, model)).toContain("5 分钟");
  });
});

describe("voiceCloneNameProblem", () => {
  it("accepts Chinese and English names", () => {
    expect(voiceCloneNameProblem("主角小满")).toBe("");
    expect(voiceCloneNameProblem("role01")).toBe("");
    expect(voiceCloneNameProblem("Hero-Voice 01")).toBe("");
  });

  it("rejects empty and overlong names", () => {
    expect(voiceCloneNameProblem("   ")).toContain("请填写");
    expect(voiceCloneNameProblem("名".repeat(31))).toContain("30");
  });
});

describe("deriveVoiceClonePrefix", () => {
  it("keeps provider-compliant names as the prefix", () => {
    expect(deriveVoiceClonePrefix("role01")).toBe("role01");
    expect(deriveVoiceClonePrefix(" HeroVoice0 ")).toBe("HeroVoice0");
  });

  it("derives an 8-char alphanumeric prefix from Chinese names", () => {
    const prefix = deriveVoiceClonePrefix("主角小满");
    expect(prefix).toMatch(/^[a-z][a-z0-9]{7}$/);
    expect(deriveVoiceClonePrefix("too-long-english-name")).toMatch(
      /^[a-z][a-z0-9]{7}$/
    );
  });
});

describe("clonedVoiceLabel", () => {
  it("shows the Chinese alias with an id tail", () => {
    expect(
      clonedVoiceLabel({
        voice_id: "cosyvoice-v3.5-plus-role01-3755faa2f683412cbbc9af9eea8737b8",
        alias: "主角小满",
      })
    ).toBe("主角小满（…37b8）");
  });

  it("falls back to the full id when no alias was saved", () => {
    expect(
      clonedVoiceLabel({ voice_id: "cosyvoice-v3.5-plus-role01-abc123" })
    ).toBe("复刻音色 · cosyvoice-v3.5-plus-role01-abc123");
    expect(clonedVoiceLabel({})).toBe("复刻音色");
    expect(clonedVoiceLabel({ alias: "  小满  " })).toBe("小满");
  });
});
