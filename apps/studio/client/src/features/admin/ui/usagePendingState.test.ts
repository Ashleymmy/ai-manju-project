import { describe, expect, it } from "vitest";
import { formatUsagePendingState } from "./usagePendingState";

describe("usage pending settlement labels", () => {
  const row = { credit_status: "reserved", pending_reason: "waiting_provider_slot", pending_age_seconds: 125 };

  it.each([
    ["waiting_dispatch", "等待任务派发"],
    ["waiting_provider_slot", "等待模型并发空位"],
    ["provider_retry_backoff", "等待自动重试"],
    ["image_recovery_pending", "图片结果待恢复"],
    ["video_recovery_pending", "视频结果待恢复"],
    ["image_submission_uncertain", "图片提交结果待确认"],
    ["video_submission_uncertain", "视频提交结果待确认"],
    ["submission_uncertain", "提交结果待确认"],
    ["video_metrics_pending", "等待成片时长核验与积分结算"],
    ["job_in_progress", "任务处理中"],
    ["reservation_pending", "积分冻结待核对"],
  ])("describes %s without exposing machine codes", (code, label) => {
    expect(formatUsagePendingState({ ...row, pending_reason: code })).toBe(`${label} · 已冻结 2 分钟`);
  });

  it.each(["released", "settled", "untracked"])("hides stale pending metadata for %s credits", status => {
    expect(formatUsagePendingState({ ...row, credit_status: status })).toBe("");
  });

  it.each(["new_worker_phase", "constructor", "__proto__"])("safely handles unknown phase %s", code => {
    expect(formatUsagePendingState({ ...row, pending_reason: code })).toBe("积分冻结待处理 · 已冻结 2 分钟");
  });

  it("distinguishes a short wait from unknown or invalid timing", () => {
    expect(formatUsagePendingState({ ...row, pending_age_seconds: 5 })).toBe("等待模型并发空位 · 已冻结 不足 1 分钟");
    for (const age of [undefined, 0, -1, NaN, Infinity]) {
      expect(formatUsagePendingState({ ...row, pending_age_seconds: age })).toBe("等待模型并发空位");
    }
    expect(formatUsagePendingState({ ...row, pending_reason: " " })).toBe("");
  });
});
