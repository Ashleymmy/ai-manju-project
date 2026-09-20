// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComicBatchDetail } from "@/entities/comic";

const api = vi.hoisted(() => ({ batch: vi.fn(), job: vi.fn() }));
vi.mock("@/entities/comic", async original => ({
  ...(await original<object>()),
  getComicBatch: api.batch,
}));
vi.mock("@/entities/job", async original => ({
  ...(await original<object>()),
  getJob: api.job,
}));
import { useComicBatchQuery, useComicBatchItemJobQuery } from "./queries";
import { COMIC_BATCH_POLL_INTERVAL_MS } from "./constants";

function detail(status: ComicBatchDetail["batch"]["status"]): ComicBatchDetail {
  return {
    batch: {
      id: "batch-1",
      status,
      project_id: "project-1",
      total: 1,
      active: status === "running" ? 1 : 0,
      pending: 0,
      succeeded: status === "succeeded" ? 1 : 0,
      failed: status === "partial_failed" ? 1 : 0,
      canceled: 0,
    } as ComicBatchDetail["batch"],
    items: [],
  };
}

describe("comic batch live queries", () => {
  let root: Root;
  let client: QueryClient;
  let container: HTMLDivElement;
  let current: ReturnType<typeof useComicBatchQuery>;
  function Batch({ snapshot }: { snapshot: ComicBatchDetail }) {
    current = useComicBatchQuery("personal", snapshot.batch.id, snapshot);
    return <span>{current.data?.batch.status}</span>;
  }
  async function render(snapshot: ComicBatchDetail) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Batch snapshot={snapshot} />
        </QueryClientProvider>
      )
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
  }
  async function tick() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMIC_BATCH_POLL_INTERVAL_MS + 1);
    });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resumes polling after a failed batch is retried and stops after completion", async () => {
    api.batch.mockResolvedValue(detail("partial_failed"));
    await render(detail("partial_failed"));
    const stoppedCalls = api.batch.mock.calls.length;
    await tick();
    expect(api.batch).toHaveBeenCalledTimes(stoppedCalls);
    api.batch.mockResolvedValue(detail("running"));
    await render(detail("running"));
    expect(current.data?.batch.status).toBe("running");
    const resumedCalls = api.batch.mock.calls.length;
    await tick();
    expect(api.batch.mock.calls.length).toBeGreaterThan(resumedCalls);
    api.batch.mockResolvedValue(detail("succeeded"));
    await tick();
    expect(current.data?.batch.status).toBe("succeeded");
    const completedCalls = api.batch.mock.calls.length;
    await tick();
    expect(api.batch).toHaveBeenCalledTimes(completedCalls);
  });

  it("cancels a stale poll before applying a control response", async () => {
    let resolveOld!: (value: ComicBatchDetail) => void;
    let oldSignal: AbortSignal | undefined;
    api.batch.mockImplementationOnce((_id, _scope, signal) => {
      oldSignal = signal;
      return new Promise(resolve => {
        resolveOld = resolve;
      });
    });
    await render(detail("running"));
    api.batch.mockResolvedValue(detail("paused"));
    await render(detail("paused"));
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => resolveOld(detail("running")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(current.data?.batch.status).toBe("paused");
  });

  it("refreshes cached results when a batch is reopened", async () => {
    api.batch.mockResolvedValue(detail("succeeded"));
    await render(detail("running"));
    expect(current.data?.batch.status).toBe("succeeded");
  });

  it("polls real job progress, recovers from fetch errors and stops on a terminal job", async () => {
    let jobQuery: ReturnType<typeof useComicBatchItemJobQuery>;
    function Job() {
      jobQuery = useComicBatchItemJobQuery("job-1", true);
      return null;
    }
    api.job
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ id: "job-1", status: "running", progress: 65 });
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Job />
        </QueryClientProvider>
      )
    );
    await tick();
    expect(jobQuery!.data?.progress).toBe(65);
    api.job.mockResolvedValue({
      id: "job-1",
      status: "succeeded",
      progress: 100,
    });
    await tick();
    expect(jobQuery!.data?.status).toBe("succeeded");
    const calls = api.job.mock.calls.length;
    await tick();
    expect(api.job).toHaveBeenCalledTimes(calls);
  });
});
