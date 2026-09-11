import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetPendingCanvasJob,
  pendingCanvasJobsForProject,
  rememberPendingCanvasJob,
} from "./pendingJobStore";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("pendingCanvasJobStore", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers and forgets jobs per project", () => {
    rememberPendingCanvasJob({
      nodeId: "node-1",
      jobId: "job-1",
      kind: "image",
      projectKey: "personal:project-1",
      savedAt: Date.now(),
    });
    rememberPendingCanvasJob({
      nodeId: "node-2",
      jobId: "job-2",
      kind: "video",
      projectKey: "personal:project-2",
      savedAt: Date.now(),
    });

    expect(pendingCanvasJobsForProject("personal:project-1")).toEqual([
      { nodeId: "node-1", jobId: "job-1" },
    ]);

    forgetPendingCanvasJob("node-1", "job-1");
    expect(pendingCanvasJobsForProject("personal:project-1")).toEqual([]);
    expect(pendingCanvasJobsForProject("personal:project-2")).toEqual([
      { nodeId: "node-2", jobId: "job-2" },
    ]);
  });
});
