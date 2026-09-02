import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { updatePreferences, type UserPreferencesPayload } from "./preferences";
import { DEFAULT_CANVAS_SHORTCUTS, shortcutActionOrder } from "@/lib/canvas-hotkeys";

/**
 * 后端 apps/api/internal/handler/user_preference.go 对每个 bucket 做键名白名单过滤，
 * 白名单外的键会被静默丢弃（接口仍返回成功）。这里把白名单固化为契约，
 * 防止再次出现「UI 提示已保存、实际未落库」的回归。
 */
const GENERATION_ALLOWED_KEYS = [
  "imageModel", "videoModel", "textModel", "audioModel",
  "quality", "size", "count", "canvasImageCount",
  "videoSeconds", "vquality", "videoGenerateAudio", "videoWatermark",
  "audioVoice", "audioFormat", "audioSpeed", "audioInstructions",
  "systemPrompt",
];

const CANVAS_ALLOWED_KEYS = ["middleButtonLockHint", "backgroundMode", "wheelZoomRequiresCtrl", "promptPresets"];

const SHORTCUT_ALLOWED_KEYS = [
  "undo", "redo", "delete", "copy", "paste", "selectAll", "runSelection", "openSettings", "resetZoom",
];

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function capturePayload() {
  const fetchMock = vi.fn(async () => new Response(
    JSON.stringify({ success: true, data: {} }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
  vi.stubGlobal("fetch", fetchMock);
  return {
    async send(payload: UserPreferencesPayload) {
      await updatePreferences(payload);
      const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
      return JSON.parse(String(init?.body ?? "{}")) as UserPreferencesPayload;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("sessionStorage", new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("user preferences contract", () => {
  it("sends shortcuts in the top-level bucket, not nested under canvas", async () => {
    const body = await capturePayload().send({
      shortcuts: DEFAULT_CANVAS_SHORTCUTS,
      canvas: { backgroundMode: "lines" },
    });

    expect(body.shortcuts).toBeDefined();
    expect(Object.keys(body.canvas ?? {})).not.toContain("shortcuts");
  });

  it("sends each shortcut action as an array of combo strings", async () => {
    const body = await capturePayload().send({ shortcuts: DEFAULT_CANVAS_SHORTCUTS });

    shortcutActionOrder.forEach((action) => {
      const combos = body.shortcuts?.[action];
      expect(Array.isArray(combos), `${action} 必须是数组，后端 sanitizeShortcuts 只接受 []any`).toBe(true);
      expect(combos?.length).toBeGreaterThan(0);
      combos?.forEach((combo) => expect(typeof combo).toBe("string"));
    });
  });

  it("only uses keys the backend whitelist accepts", async () => {
    const body = await capturePayload().send({
      generation: {
        imageModel: "m", videoModel: "v", textModel: "t", audioModel: "a",
        quality: "auto", size: "1:1", count: "1", canvasImageCount: "3",
        videoSeconds: "6", vquality: "720", videoGenerateAudio: "true", videoWatermark: "false",
        audioVoice: "alloy", audioFormat: "mp3", audioSpeed: "1", audioInstructions: "",
        systemPrompt: "",
      },
      shortcuts: DEFAULT_CANVAS_SHORTCUTS,
      canvas: { backgroundMode: "lines", wheelZoomRequiresCtrl: true, middleButtonLockHint: true, promptPresets: [] },
    });

    Object.keys(body.generation ?? {}).forEach((key) => expect(GENERATION_ALLOWED_KEYS).toContain(key));
    Object.keys(body.canvas ?? {}).forEach((key) => expect(CANVAS_ALLOWED_KEYS).toContain(key));
    Object.keys(body.shortcuts ?? {}).forEach((key) => expect(SHORTCUT_ALLOWED_KEYS).toContain(key));
  });
});
