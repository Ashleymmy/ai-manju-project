import { describe, expect, it } from "vitest";
import { jobProgressNotice } from "./api";

describe("job recovery notices", () => {
  it("distinguishes a task awaiting reconciliation from an automatic recovery", () => {
    expect(jobProgressNotice({ status: "queued", queue_phase: "video_submission_uncertain" })).toContain("勿重复生成");
    expect(jobProgressNotice({ status: "queued", queue_phase: "video_recovery_pending" })).toContain("正在恢复原视频任务");
    expect(jobProgressNotice({ status: "succeeded", queue_phase: "video_recovery_pending" })).toBeUndefined();
    expect(jobProgressNotice({ status: "running", queue_phase: "private-supplier-phase" })).toBeUndefined();
  });
});
