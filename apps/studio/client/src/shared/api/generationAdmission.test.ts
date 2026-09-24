import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./http";
import { GENERATION_ADMISSION_RETRY_MS, GENERATION_ADMISSION_WAIT_MS, submitWithGenerationAdmission } from "./generationAdmission";

afterEach(() => vi.useRealTimers());

describe("generation admission queues", () => {
  it.each(["image", "video", "text", "audio"] as const)("queues excess %s submissions in order, using capacity again when it is released", async capability => {
    vi.useFakeTimers();
    const submitted: number[] = [];
    let active = 0;
    let highWater = 0;
    const completed: number[] = [];
    const waiting = vi.fn();
    const runs = Array.from({ length: 6 }, (_, id) => submitWithGenerationAdmission(capability, async () => {
      if (active >= 2) throw new ApiError("当前视频任务并发已达上限，请等待进行中的任务完成后重试", 429);
      submitted.push(id);
      active++;
      highWater = Math.max(highWater, active);
      setTimeout(() => { active--; completed.push(id); }, GENERATION_ADMISSION_RETRY_MS);
      return id;
    }, { onWaiting: waiting }));
    await vi.advanceTimersByTimeAsync(0);
    expect(submitted).toEqual([0, 1]);
    await vi.runAllTimersAsync();
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(submitted).toEqual([0, 1, 2, 3, 4, 5]);
    expect(completed).toHaveLength(6);
    expect(highWater).toBe(2);
    expect(waiting).toHaveBeenCalledWith(true);
    expect(waiting).toHaveBeenLastCalledWith(false);
  });

  it("cancels queued and capacity-blocked tasks without blocking later work or another capability", async () => {
    vi.useFakeTimers();
    const first = new AbortController(), second = new AbortController();
    const blocked = vi.fn().mockRejectedValue(new ApiError("当前任务并发已达上限", 429));
    const head = submitWithGenerationAdmission("image", blocked, { signal: first.signal }).catch(error => error);
    const skipped = vi.fn();
    const queued = submitWithGenerationAdmission("image", skipped, { signal: second.signal }).catch(error => error);
    const next = submitWithGenerationAdmission("image", async () => "next");
    expect(await submitWithGenerationAdmission("video", async () => "video")).toBe("video");
    second.abort();
    expect(await queued).toMatchObject({ name: "AbortError" });
    first.abort();
    expect(await head).toMatchObject({ name: "AbortError" });
    expect(await next).toBe("next");
    await vi.runAllTimersAsync();
    expect(skipped).not.toHaveBeenCalled();
    expect(blocked).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry real failures or replay an accepted job, and releases the queue after rejection", async () => {
    for (const error of [new ApiError("余额不足", 402), new ApiError("网络断开", 0), new ApiError("quota exhausted", 429), new ApiError("provider failed", 502)]) {
      const submit = vi.fn().mockRejectedValue(error);
      await expect(submitWithGenerationAdmission("video", submit)).rejects.toBe(error);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(await submitWithGenerationAdmission("video", async () => "accepted-job")).toBe("accepted-job");
    }
  });

  it("bounds a permanently blocked submission and lets the next queued task proceed", async () => {
    vi.useFakeTimers();
    const error = new ApiError("当前任务并发已达上限", 429);
    const blocked = submitWithGenerationAdmission("image", async () => { throw error; }).catch(value => value);
    const next = submitWithGenerationAdmission("image", async () => "next");
    await vi.advanceTimersByTimeAsync(GENERATION_ADMISSION_WAIT_MS);
    expect(await blocked).toBe(error);
    expect(await next).toBe("next");
    expect(vi.getTimerCount()).toBe(0);
  });
});
