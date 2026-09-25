import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./sha256";

afterEach(() => vi.unstubAllGlobals());
describe("HTTP-safe recovery digest", () => {
  it.each(["", "abc", "演员进入场景🎬", ...[55, 56, 63, 64, 65, 120_000].map(n => "a".repeat(n))])("matches SHA-256 at UTF-8 and block boundaries (%#)", async input => {
    vi.stubGlobal("crypto", {});
    expect(await sha256Hex(input)).toBe(createHash("sha256").update(input).digest("hex"));
  });
  it("preserves the same identity on HTTP, HTTPS and denied WebCrypto", async () => {
    const input = JSON.stringify(["test-account", { script: "original script" }]);
    vi.stubGlobal("crypto", webcrypto);
    const secure = await sha256Hex(input);
    vi.stubGlobal("crypto", undefined);
    expect(await sha256Hex(input)).toBe(secure);
    vi.stubGlobal("crypto", { subtle: { digest: () => Promise.reject(new Error("denied")) } });
    expect(await sha256Hex(input)).toBe(secure);
  });
});
