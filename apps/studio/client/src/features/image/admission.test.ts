import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/http";
import { waitForImageAdmission } from "./api";

afterEach(() => vi.useRealTimers());
describe("image batch admission", () => {
  it("keeps excess batch items waiting and admits them when slots release", async () => {
    vi.useFakeTimers();
    const submit = vi.fn().mockRejectedValueOnce(new ApiError("当前任务并发已达上限，请稍后重试或升级会员", 429)).mockRejectedValueOnce(new ApiError("当前任务并发已达上限", 429)).mockResolvedValue({ id: "one-job" });
    const pending = waitForImageAdmission(submit);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ id: "one-job" });
    expect(submit).toHaveBeenCalledTimes(3);
  });
  it("cancels waiting without submitting again", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const submit = vi.fn().mockRejectedValue(new ApiError("当前任务并发已达上限", 429));
    const pending = waitForImageAdmission(submit, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("does not retry payment, ambiguous network failures or unrelated throttles", async () => {
    for (const error of [new ApiError("余额不足", 402), new ApiError("网络异常", 0), new ApiError("quota exhausted", 429)]) {
      const submit = vi.fn().mockRejectedValue(error);
      await expect(waitForImageAdmission(submit)).rejects.toBe(error);
      expect(submit).toHaveBeenCalledTimes(1);
    }
  });
});
