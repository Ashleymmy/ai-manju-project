import { describe, expect, it } from "vitest";

import {
  activityActive,
  countdownParts,
  daysUntil,
  discountLabel,
  discountedCents,
  effectiveCreditsPerYuan,
  formatCents,
  formatCredits,
} from "./format";

describe("member format helpers", () => {
  it("formats cents into ¥ 文案", () => {
    expect(formatCents(19800)).toBe("¥198.00");
    expect(formatCents(384)).toBe("¥3.84");
    expect(formatCents(0)).toBe("¥0.00");
    expect(formatCents(undefined)).toBe("¥0.00");
  });

  it("formats credits with separators", () => {
    expect(formatCredits(12400)).toBe("12,400");
    expect(formatCredits(undefined)).toBe("0");
  });

  it("computes effective credits per yuan with member discount", () => {
    // 修复项：折扣后文案必须动态计算（8 折 → 125 积分/元）
    expect(effectiveCreditsPerYuan(100, 8000)).toBe(125);
    expect(effectiveCreditsPerYuan(100, 10_000)).toBe(100);
    expect(effectiveCreditsPerYuan(100, 0)).toBe(100);
  });

  it("applies discount in cents with the same floor rule as backend", () => {
    expect(discountedCents(600, 8000)).toBe(480);
    expect(discountedCents(19800, 8000)).toBe(15_840);
    expect(discountedCents(19800, 10_000)).toBe(19800);
  });

  it("labels discount bps", () => {
    expect(discountLabel(8000)).toBe("8 折");
    expect(discountLabel(7500)).toBe("7.5 折");
    expect(discountLabel(10_000)).toBe("无折扣");
  });

  it("computes days until expiry", () => {
    const now = new Date("2026-07-01T00:00:00Z");
    expect(daysUntil("2026-07-08T00:00:00Z", now)).toBe(7);
    expect(daysUntil("2026-06-01T00:00:00Z", now)).toBe(0);
    expect(daysUntil(undefined, now)).toBe(0);
  });

  it("splits countdown and respects activity window", () => {
    const now = new Date("2026-07-01T00:00:00Z").getTime();
    const parts = countdownParts("2026-07-03T01:02:03Z", now);
    expect(parts).toEqual({ days: 2, hours: 1, minutes: 2, seconds: 3 });
    expect(countdownParts("2026-06-01T00:00:00Z", now)).toBeNull();
    expect(
      activityActive(
        { enabled: true, starts_at: "2026-06-01T00:00:00Z", ends_at: "2026-08-01T00:00:00Z" },
        now,
      ),
    ).toBe(true);
    expect(activityActive({ enabled: false }, now)).toBe(false);
    expect(
      activityActive({ enabled: true, ends_at: "2026-06-01T00:00:00Z" }, now),
    ).toBe(false);
  });
});
