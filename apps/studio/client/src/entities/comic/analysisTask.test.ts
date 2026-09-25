// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { ApiError } from "@/shared/api/http";
import { awaitComicAnalysis } from "./analysisTask";
import type { ComicAnalysisDetail } from "./model";

function detail(status: ComicAnalysisDetail["session"]["status"]): ComicAnalysisDetail {
  return { session: { id: "analysis-1", status, title: "test", style_preset: "", active_revision_id: "", confirmed_revision_id: "", project_id: "", source_file_name: "test.txt", analysis_error: "模型服务未能完成剧本分析" }, revisions: [] };
}

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  vi.stubGlobal("crypto", { subtle: { digest: async (_: string, data: Uint8Array) => new Uint8Array(createHash("sha256").update(data).digest()).buffer } });
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function finish<T>(promise: Promise<T>) {
  await vi.runAllTimersAsync();
  return promise;
}

describe("background comic analysis", () => {
  it("polls slow analysis and never submits twice after a gateway failure", async () => {
    const submit = vi.fn().mockResolvedValue(detail("processing"));
    const read = vi.fn().mockRejectedValueOnce(new ApiError("gateway", 504)).mockResolvedValueOnce(detail("processing")).mockResolvedValue(detail("active"));
    const result = await finish(awaitComicAnalysis(submit, read, { script: "test" }));
    expect(result.session.status).toBe("active");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(3);
    expect(sessionStorage.length).toBe(0);
  });

  it("resumes the saved task on the next click after connection failures", async () => {
    const submit = vi.fn().mockResolvedValue(detail("processing"));
    const read = vi.fn().mockRejectedValue(new ApiError("offline", 0));
    const first = expect(awaitComicAnalysis(submit, read, { script: "test" })).rejects.toThrow("任务仍保留");
    await finish(first);
    expect(sessionStorage.length).toBe(1);
    read.mockResolvedValue(detail("active"));
    await finish(awaitComicAnalysis(submit, read, { script: "test" }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
  });

  it("shows an actual model failure and clears the completed task", async () => {
    const result = expect(awaitComicAnalysis(() => Promise.resolve(detail("processing")), () => Promise.resolve(detail("failed")), {})).rejects.toThrow("模型服务未能完成");
    await finish(result);
    expect(sessionStorage.length).toBe(0);
  });

  it.each([true, false])("retains timed-out analysis and recovers on the next click (WebCrypto=%s)", async secure => {
    if (!secure) vi.stubGlobal("crypto", {});
    const submit = vi.fn().mockResolvedValue(detail("processing"));
    const uncertain = detail("failed");
    uncertain.session.analysis_recovery_pending = true;
    uncertain.session.analysis_error = "结果尚未确认，请查看原任务";
    const read = vi.fn().mockResolvedValueOnce(uncertain).mockResolvedValueOnce(detail("active"));
    await finish(expect(awaitComicAnalysis(submit, read, { script: "same" })).rejects.toThrow("结果尚未确认"));
    expect(sessionStorage.length).toBe(1);
    const recovered = await finish(awaitComicAnalysis(submit, read, { script: "same" }));
    expect(recovered.session.status).toBe("active");
    expect(submit).toHaveBeenCalledOnce();
    expect(read).toHaveBeenNthCalledWith(2, "analysis-1");
    expect(sessionStorage.length).toBe(0);
  });

  it("preserves synchronous compatibility and never retries a failed submission", async () => {
    const read = vi.fn();
    await finish(awaitComicAnalysis(() => Promise.resolve(detail("active")), read, {}));
    expect(read).not.toHaveBeenCalled();
    const submit = vi.fn().mockRejectedValue(new ApiError("gateway", 504));
    await finish(expect(awaitComicAnalysis(submit, read, {})).rejects.toMatchObject({ status: 504 }));
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
