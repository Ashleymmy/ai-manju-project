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
});
