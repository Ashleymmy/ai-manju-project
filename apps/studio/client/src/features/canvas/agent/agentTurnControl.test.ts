// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  copyAgentMessageText,
  isAgentTurnCancelled,
} from "./agentTurnControl";

describe("Agent turn control", () => {
  it("treats abort errors as a cancelled turn", () => {
    expect(isAgentTurnCancelled(new DOMException("Aborted", "AbortError"))).toBe(true);
    expect(isAgentTurnCancelled({ name: "AbortError" })).toBe(true);
    expect(isAgentTurnCancelled({ cancelled: true })).toBe(true);
    expect(isAgentTurnCancelled(new Error("在线 Agent 请求失败"))).toBe(false);
  });

  it("copies message text and rejects empty content", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    expect(await copyAgentMessageText("   ")).toBe("empty");
    expect(writeText).not.toHaveBeenCalled();
    expect(await copyAgentMessageText("一篮新鲜蓝莓")).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("一篮新鲜蓝莓");

    writeText.mockRejectedValueOnce(new Error("denied"));
    expect(await copyAgentMessageText("一篮新鲜蓝莓")).toBe("failed");
    vi.unstubAllGlobals();
  });

  it("falls back to the legacy copy command when async clipboard is unavailable", async () => {
    const originalExecCommand = document.execCommand;
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    vi.stubGlobal("navigator", {});

    expect(await copyAgentMessageText("兼容复制内容")).toBe("copied");
    expect(execCommand).toHaveBeenCalledWith("copy");

    vi.unstubAllGlobals();
    if (originalExecCommand) Object.defineProperty(document, "execCommand", { configurable: true, value: originalExecCommand });
    else Reflect.deleteProperty(document, "execCommand");
  });

  it("uses the fallback after an async clipboard rejection", async () => {
    const originalExecCommand = document.execCommand;
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });

    expect(await copyAgentMessageText("权限失败后仍可复制")).toBe("copied");
    expect(execCommand).toHaveBeenCalledWith("copy");

    vi.unstubAllGlobals();
    if (originalExecCommand) Object.defineProperty(document, "execCommand", { configurable: true, value: originalExecCommand });
    else Reflect.deleteProperty(document, "execCommand");
  });
});
