import { describe, expect, it } from "vitest";

import {
  ADMIN_EDITABLE_CONFIGS,
  adminConsumptionStatusLabel,
  adminConsumptionStatusTone,
  adminConsumptionSuccessRate,
  adminLedgerTypeLabel,
  adminOrderStatusLabel,
  adminOrderStatusTone,
  adminTaskTypeLabel,
  adminUserStatusLabel,
  adminUserStatusTone,
  aggregateLedgerAmounts,
  auditActionLabel,
  createAdjustNonce,
  formatAuditDetail,
  inviteRewardStatusLabel,
  inviteRewardStatusTone,
  memberLevelLabel,
  normalizeAdminPaged,
  normalizeConsumptionStats,
  parseConfigValue,
  timeRangeStartIso,
  yuanToCents,
} from "./memberAdmin";

describe("admin member module labels", () => {
  it("maps ledger / order / task / audit codes to Chinese labels with fallback", () => {
    expect(adminLedgerTypeLabel("admin_add")).toBe("后台调增");
    expect(adminLedgerTypeLabel("refund_rollback")).toBe("退款回滚");
    expect(adminLedgerTypeLabel("unknown_x")).toBe("unknown_x");
    expect(adminOrderStatusLabel("paid")).toBe("已支付");
    expect(adminTaskTypeLabel("video_fast")).toBe("视频 Fast 渲染");
    expect(auditActionLabel("adjust_credits")).toBe("调整积分");
    expect(adminConsumptionStatusLabel("released")).toBe("失败/取消（未扣费）");
  });

  it("maps statuses to TapNow pill tones (成功绿 / 失败红 / 待处理灰)", () => {
    expect(adminOrderStatusTone("paid")).toBe("green");
    expect(adminOrderStatusTone("refunded")).toBe("red");
    expect(adminOrderStatusTone("pending")).toBe("gray");
    expect(adminOrderStatusTone("closed")).toBe("gray");
    expect(adminConsumptionStatusTone("settled")).toBe("green");
    expect(adminConsumptionStatusTone("released")).toBe("red");
    expect(adminConsumptionStatusTone("reserved")).toBe("gray");
    expect(adminUserStatusTone("active")).toBe("green");
    expect(adminUserStatusTone("disabled")).toBe("red");
    expect(adminUserStatusLabel("disabled")).toBe("已禁用");
  });

  it("labels member level and invite reward status", () => {
    expect(memberLevelLabel("198 会员")).toBe("198 会员");
    expect(memberLevelLabel("")).toBe("免费版");
    expect(memberLevelLabel(undefined)).toBe("免费版");
    expect(inviteRewardStatusLabel("pending_first_recharge")).toBe("待发放（待首充）");
    expect(inviteRewardStatusTone("granted")).toBe("green");
    expect(inviteRewardStatusTone("pending_first_recharge")).toBe("blue");
    expect(inviteRewardStatusTone("expired")).toBe("gray");
  });
});

describe("ledger aggregation and consumption stats", () => {
  it("aggregates page items into increase / decrease totals", () => {
    expect(aggregateLedgerAmounts([{ amount: 500 }, { amount: -120 }, { amount: 0 }, { amount: -30 }])).toEqual({
      increase: 500,
      decrease: 150,
    });
    expect(aggregateLedgerAmounts([])).toEqual({ increase: 0, decrease: 0 });
    expect(aggregateLedgerAmounts([{ amount: Number.NaN }])).toEqual({ increase: 0, decrease: 0 });
  });

  it("computes success rate over terminal states only", () => {
    expect(
      adminConsumptionSuccessRate({ success_count: 9, released_count: 1, failed_count: 0, reserved_count: 5 } as never),
    ).toBe(90);
    expect(adminConsumptionSuccessRate({ success_count: 0, released_count: 0 } as never)).toBe(100);
    expect(adminConsumptionSuccessRate(null)).toBe(100);
  });

  it("normalizes PascalCase backend stats keys (contract gap: Go struct without json tags)", () => {
    const normalized = normalizeConsumptionStats({
      TotalCreditsSettled: 1234,
      SuccessCount: 7,
      ReleasedCount: 3,
      ReservedCount: 2,
      ImageCount: 5,
      VideoSeconds: 60,
      AgentCalls: 1,
    });
    expect(normalized).toEqual({
      total_credits_settled: 1234,
      success_count: 7,
      failed_count: 0,
      released_count: 3,
      reserved_count: 2,
      image_count: 5,
      video_seconds: 60,
      agent_calls: 1,
    });
    expect(normalizeConsumptionStats({ success_count: 2 }).success_count).toBe(2);
    expect(normalizeConsumptionStats(undefined).total_credits_settled).toBe(0);
  });
});

describe("paged normalization and config validation", () => {
  it("normalizes partial paged payloads into safe defaults", () => {
    expect(normalizeAdminPaged<{ id: string }>(null)).toEqual({ items: [], total: 0, page: 1, page_size: 20 });
    expect(normalizeAdminPaged({ items: [{ id: "a" }], total: 42, page: 2, page_size: 10 })).toEqual({
      items: [{ id: "a" }],
      total: 42,
      page: 2,
      page_size: 10,
    });
    expect(normalizeAdminPaged({ items: "oops" } as never).items).toEqual([]);
  });

  it("validates config textarea input against the whitelist schema", () => {
    expect(parseConfigValue("1000", "int")).toEqual({ ok: true, value: 1000 });
    expect(parseConfigValue("1.5", "int")).toMatchObject({ ok: false });
    expect(parseConfigValue("{\"enabled\":true}", "json")).toEqual({ ok: true, value: { enabled: true } });
    expect(parseConfigValue("not-json", "json")).toMatchObject({ ok: false });
    expect(parseConfigValue("   ", "json")).toMatchObject({ ok: false });
  });

  it("covers every whitelisted config key the backend accepts", () => {
    expect(ADMIN_EDITABLE_CONFIGS.map(item => item.key)).toEqual([
      "register_bonus_credits",
      "register_bonus_ttl_days",
      "invite_rewards",
      "invite_reward_ttl_days",
      "activity_discount",
      "pricing_rules",
      "gift_packs",
    ]);
  });
});

describe("misc helpers", () => {
  it("formats audit detail into a readable single-line snapshot", () => {
    expect(formatAuditDetail(undefined)).toBe("—");
    expect(formatAuditDetail(null)).toBe("—");
    expect(formatAuditDetail("plain")).toBe("plain");
    expect(formatAuditDetail({ before: 100, after: 200 })).toBe('{"before":100,"after":200}');
  });

  it("converts quick time ranges into RFC3339 start timestamps", () => {
    const now = new Date("2026-07-08T00:00:00.000Z");
    expect(timeRangeStartIso(0, now)).toBeUndefined();
    expect(timeRangeStartIso(7, now)).toBe("2026-07-01T00:00:00.000Z");
  });

  it("converts yuan input to cents and rejects invalid values", () => {
    expect(yuanToCents("198")).toBe(19800);
    expect(yuanToCents("3.84")).toBe(384);
    expect(yuanToCents("0")).toBe(0);
    expect(yuanToCents("-1")).toBeNull();
    expect(yuanToCents("abc")).toBeNull();
    expect(yuanToCents("")).toBeNull();
  });

  it("generates unique prefixed nonces for credit adjustments", () => {
    const first = createAdjustNonce();
    const second = createAdjustNonce();
    expect(first).toMatch(/^adj-[0-9a-f-]{36}$/);
    expect(second).toMatch(/^adj-[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
  });
});
