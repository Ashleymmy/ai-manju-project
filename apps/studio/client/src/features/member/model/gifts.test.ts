import { describe, expect, it } from "vitest";

import { GIFT_EMPTY_TEXT, giftContentLabel, normalizeGiftPacks } from "./gifts";

describe("gift pack normalization", () => {
  it("returns an empty shelf for missing or malformed payloads", () => {
    expect(normalizeGiftPacks(undefined)).toEqual([]);
    expect(normalizeGiftPacks(null)).toEqual([]);
    expect(normalizeGiftPacks({})).toEqual([]);
    expect(normalizeGiftPacks({ items: "oops" })).toEqual([]);
  });

  it("fills defaults for missing fields and keeps tolerant ids", () => {
    const [item] = normalizeGiftPacks({ items: [{}] });
    expect(item).toEqual({
      id: "gift-1",
      name: "未命名礼包",
      description: "",
      cover: "",
      price_cents: 0,
      credits: 0,
      membership_days: 0,
      enabled: true,
      sort_order: 0,
    });
  });

  it("accepts a bare array, filters disabled packs and sorts by sort_order", () => {
    const items = normalizeGiftPacks([
      { id: "b", name: "B", price_cents: 200, credits: 200, sort_order: 2 },
      { id: "off", name: "下架", enabled: false },
      { id: "a", name: "A", price_cents: 100, credits: 100, sort_order: 1 },
    ]);
    expect(items.map(item => item.id)).toEqual(["a", "b"]);
  });

  it("clamps negative numeric fields to zero", () => {
    const [item] = normalizeGiftPacks({ items: [{ id: "x", price_cents: -5, credits: -1 }] });
    expect(item.price_cents).toBe(0);
    expect(item.credits).toBe(0);
  });
});

describe("gift content label", () => {
  it("prefers credits, then membership days, then placeholder", () => {
    expect(giftContentLabel({ credits: 5000, membership_days: 0 })).toBe("5,000 积分");
    expect(giftContentLabel({ credits: 0, membership_days: 30 })).toBe("30 天会员");
    expect(giftContentLabel({ credits: 0, membership_days: 0 })).toBe("内容待定");
  });

  it("keeps the empty-shelf copy stable", () => {
    expect(GIFT_EMPTY_TEXT).toBe("礼包筹备中，敬请期待");
  });
});
