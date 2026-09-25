import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAiModels, requestAiText } from "./ai";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function apiResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, data }), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": "text-request" },
  });
}

describe("text AI API", () => {
  beforeEach(() => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retrieves the original tool response after a lost POST response without replaying generation", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("connection lost"));
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ content: "原文", model: "original-model",
      tool_calls: [{ id: "tool-1", function: { name: "inspect", arguments: "{}" } }], finish_reason: "tool_calls" }));
    const result = await requestAiText({ prompt: "测试" }, undefined, undefined, { key: "receipt-1", scope: "team" });
    expect(result).toMatchObject({ content: "原文", model: "original-model", toolCalls: [{ id: "tool-1" }], finishReason: "tool_calls" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe("POST");
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({ "Idempotency-Key": "receipt-1" });
    const [url, options] = vi.mocked(fetch).mock.calls[1];
    expect(new URL(String(url)).pathname).toBe("/api/ai/receipts/text/receipt-1/result");
    expect(new URL(String(url)).searchParams.get("scope")).toBe("team");
    expect(options?.method).not.toBe("POST");
  });

  it("only reconciles after refresh and does not regenerate when the recovery endpoint is unavailable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse(undefined, 404));
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse(undefined, 404));
    await expect(requestAiText({ model: "changed-model", prompt: "changed" }, undefined, undefined,
      { key: "original-key", scope: "personal", recoverOnly: true })).rejects.toThrow("未找到原生成回执");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][1]?.method).not.toBe("POST");
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain("/receipts/text/original-key/reconcile");
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).endsWith("/api/ai/text"))).toBe(true);
  });

  it("polls a running receipt and returns the exact original result", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ receipt: { status: "running" } }, 202));
      vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ content: "原任务完成" }));
      const result = requestAiText({}, undefined, undefined, { key: "running", recoverOnly: true });
      await vi.advanceTimersByTimeAsync(1_500);
      expect((await result).content).toBe("原任务完成");
      expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("keeps the Agent-capable text model list separate from ordinary text models", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({
      text_models: ["provider::plain-text", "provider::agent-text"],
      agent_text_models: ["provider::agent-text"],
      default_text_model: "provider::plain-text",
      model_labels: { "provider::agent-text": "Agent Text" },
    }));

    const result = await fetchAiModels();

    expect(result.textModels).toEqual(["provider::plain-text", "provider::agent-text"]);
    expect(result.agentTextModels).toEqual(["provider::agent-text"]);
    expect(result.defaultTextModel).toBe("provider::plain-text");
  });

  it("submits the production text contract and normalizes the response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ content: "生成结果", model: "provider::text-v2" }));

    const result = await requestAiText({
      model: "provider::text-v2",
      messages: [{ role: "user", content: "改写这段文字" }],
    });

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/ai/text");
    expect(options.method).toBe("POST");
    expect(JSON.parse(String(options.body))).toMatchObject({
      model: "provider::text-v2",
      prompt: "改写这段文字",
      parallel_tool_calls: false,
      stream: false,
    });
    expect(result).toEqual({
      content: "生成结果",
      model: "provider::text-v2",
      toolCalls: [],
      finishReason: "",
    });
  });

  it("does not offer image models when the server explicitly returns no text models", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({
      models: ["provider::image-only"],
      text_models: [],
      image_models: ["provider::image-only"],
    }));

    const result = await fetchAiModels();
    expect(result.textModels).toEqual([]);
    expect(result.agentTextModels).toEqual([]);
    expect(result.defaultTextModel).toBe("");
  });

  it("preserves multimodal image content in the text request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ content: "图像描述" }));

    await requestAiText({
      model: "provider::vision-v1",
      messages: [{
        role: "user",
        content: [
          { type: "input_text", text: "反推提示词" },
          { type: "input_image", image_url: { url: "data:image/png;base64,reference" } },
        ],
      }],
    });

    const [, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(options.body))).toMatchObject({
      messages: [{
        role: "user",
        content: [
          { type: "input_text", text: "反推提示词" },
          { type: "input_image", image_url: { url: "data:image/png;base64,reference" } },
        ],
      }],
    });
  });

  it("preserves function calls and tool results for an agent continuation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ content: "操作完成" }));

    await requestAiText({
      model: "provider::agent-v1",
      messages: [
        { role: "user", content: "读取画布" },
        { type: "function_call", call_id: "call-1", name: "canvas_get_state", arguments: "{}" },
        { role: "tool", tool_call_id: "call-1", content: "{\"ok\":true}" },
      ],
      tools: [{ type: "function", function: { name: "canvas_get_state", parameters: { type: "object" } } }],
      tool_choice: "auto",
    });

    const [, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(options.body))).toMatchObject({
      messages: [
        { role: "user", content: "读取画布" },
        { type: "function_call", call_id: "call-1", name: "canvas_get_state", arguments: "{}" },
        { role: "tool", tool_call_id: "call-1", content: "{\"ok\":true}" },
      ],
      tool_choice: "auto",
      parallel_tool_calls: false,
    });
  });

  it("forwards the caller abort signal", async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));

    const result = requestAiText({ model: "text-v1", prompt: "取消测试" }, controller.signal);
    controller.abort();

    await expect(result).rejects.toThrow("请求超时或已取消");
    expect((vi.mocked(fetch).mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("does not cut off supplier attempts at the normal request timeout", async () => {
    vi.useFakeTimers();
    try {
      let finish!: (response: Response) => void;
      vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise((resolve, reject) => {
        finish = resolve;
        options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
      const result = requestAiText({ prompt: "等待生成" });
      await vi.advanceTimersByTimeAsync(60_000);
      expect((vi.mocked(fetch).mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false);
      finish(apiResponse({ text: "完成" }));
      expect((await result).content).toBe("完成");
    } finally {
      vi.useRealTimers();
    }
  });
});
