// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationCallbacks } from "../api";
import type { WorkspaceScope } from "@/shared/config";
import { ApiError } from "@/shared/api/http";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), wait: vi.fn(), images: vi.fn(), cancel: vi.fn() }));
vi.mock("../api", () => ({ generateImages: mocks.generate, waitForImageJob: mocks.wait, generatedImagesFromJob: mocks.images }));
vi.mock("@/entities/job", () => ({ cancelJob: mocks.cancel, jobErrorMessage: () => "Task failed" }));
import { useImageTaskSession } from "./useImageTaskSession";

let root: Root;
let container: HTMLDivElement;
let current: ReturnType<typeof useImageTaskSession>;
const callbacks = { onCompleted: vi.fn(), onError: vi.fn(), onStopped: vi.fn() };
const key = (owner = "owner", scope = "personal") => `ai-manju.image-pending-job.v1:${owner}:${scope}`;
function Harness({ owner = "owner", scope = "personal" }: { owner?: string; scope?: WorkspaceScope }) {
  current = useImageTaskSession(owner, scope, callbacks);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  root = createRoot(container);
  mocks.images.mockResolvedValue([{ id: "result", assetId: "result", src: "" }]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("image workbench accepted tasks", () => {
  it("clears an authoritative missing task ID without automatically submitting a replacement", async () => {
    localStorage.setItem(key(), "job-missing");
    mocks.wait.mockRejectedValueOnce(new ApiError("job not found", 404));
    await act(async () => root.render(<Harness />));
    expect(localStorage.getItem(key())).toBeNull();
    expect(current.jobId).toBeNull();
    expect(current.generating).toBe(false);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledOnce();
    mocks.generate.mockImplementation(async (_input, options: GenerationCallbacks) => {
      options.onAccepted?.({ id: "job-new" });
      return { images: [{ id: "result", assetId: "result", src: "" }] };
    });
    await act(async () => current.generate({ model: "image", prompt: "new explicit request" }));
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.wait).toHaveBeenCalledOnce();
  });

  it.each([0, 408, 429, 500, 503, 403])("retains the accepted ID on a task query HTTP %s error", async status => {
    localStorage.setItem(key(), "job-accepted");
    mocks.wait.mockRejectedValueOnce(new ApiError("query failed", status));
    await act(async () => root.render(<Harness />));
    expect(localStorage.getItem(key())).toBe("job-accepted");
    expect(current.jobId).toBe("job-accepted");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("does not treat a missing result asset as a missing accepted task", async () => {
    localStorage.setItem(key(), "job-complete");
    mocks.wait.mockResolvedValueOnce({ id: "job-complete", status: "succeeded" });
    mocks.images.mockRejectedValueOnce(new ApiError("asset not found", 404));
    await act(async () => root.render(<Harness />));
    expect(localStorage.getItem(key())).toBe("job-complete");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("persists acceptance, detaches on unmount, and resumes the same job without resubmitting", async () => {
    mocks.generate.mockImplementation((_input, options: GenerationCallbacks) => new Promise((_resolve, reject) => {
      options.onAccepted?.({ id: "job-one" });
      options.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    await act(async () => root.render(<Harness />));
    let running!: Promise<void>;
    await act(async () => { running = current.generate({ model: "image", prompt: "test" }); });
    expect(localStorage.getItem(key())).toBe("job-one");
    await act(async () => root.render(null));
    await running;
    expect(localStorage.getItem(key())).toBe("job-one");
    mocks.wait.mockResolvedValue({ id: "job-one", status: "succeeded" });
    await act(async () => root.render(<Harness />));
    expect(mocks.wait).toHaveBeenCalledWith("job-one", expect.anything());
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(current.result[0].assetId).toBe("result");
    expect(localStorage.getItem(key())).toBeNull();
  });

  it("isolates owner and scope and ignores the old session's late result", async () => {
    localStorage.setItem(key(), "job-owner");
    let release!: (job: unknown) => void;
    mocks.wait.mockReturnValue(new Promise(resolve => { release = resolve; }));
    await act(async () => root.render(<Harness />));
    await act(async () => root.render(<Harness owner="other" scope="team" />));
    expect(mocks.wait).toHaveBeenCalledOnce();
    expect(current.generating).toBe(false);
    await act(async () => release({ id: "job-owner", status: "succeeded" }));
    expect(current.result).toEqual([]);
    expect(callbacks.onCompleted).not.toHaveBeenCalled();
    expect(localStorage.getItem(key())).toBe("job-owner");
  });

  it("keeps polling after cancellation fails and receives the original result", async () => {
    localStorage.setItem(key(), "job-running");
    let release!: (job: unknown) => void;
    mocks.wait.mockReturnValue(new Promise(resolve => { release = resolve; }));
    mocks.cancel.mockRejectedValue(new Error("Network unavailable"));
    await act(async () => root.render(<Harness />));
    const signal = mocks.wait.mock.calls[0][1].signal;
    await act(async () => current.stop());
    expect(signal.aborted).toBe(false);
    expect(current.generating).toBe(true);
    expect(localStorage.getItem(key())).toBe("job-running");
    await act(async () => release({ id: "job-running", status: "succeeded" }));
    expect(current.result[0].assetId).toBe("result");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("retains a task after query failure and a repeated click reconnects instead of generating again", async () => {
    localStorage.setItem(key(), "job-accepted");
    mocks.wait.mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce({ id: "job-accepted", status: "succeeded" });
    await act(async () => root.render(<Harness />));
    expect(localStorage.getItem(key())).toBe("job-accepted");
    await act(async () => current.generate({ model: "image", prompt: "test" }));
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.wait).toHaveBeenCalledTimes(2);
    expect(current.result[0].assetId).toBe("result");
  });
});
