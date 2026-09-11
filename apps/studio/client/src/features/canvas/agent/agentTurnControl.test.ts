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
});
