import { afterEach, expect, it, vi } from "vitest";
import type { ImportTask } from "./importTaskStorage";
const storage = vi.hoisted(() => ({ get: vi.fn(), command: vi.fn() }));
vi.mock("./importTaskStorage", () => ({ IMPORT_POLL_MS: 3000, importTaskStorage: storage }));
vi.mock("@/shared/api/http/request", () => ({ getAuthToken: () => "test-token" }));
import { ImportTaskManager } from "./importTaskManager";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it("does not rerender idle history on every storage poll but observes another tab's deletion", async () => {
  vi.useFakeTimers();
  const task: ImportTask = { id: "task", owner: "alice", name: "package.zip", size: 1, scope: "personal", status: "completed", warnings: [], progress: { phase: "导入完成", completed: 1, total: 1, failures: [] } };
  storage.get.mockImplementation(async () => structuredClone(task));
  const manager = new ImportTaskManager(), listener = vi.fn();
  manager.subscribe(listener);
  manager.setOwner("alice");
  await vi.advanceTimersByTimeAsync(0);
  const calls = listener.mock.calls.length;
  await vi.advanceTimersByTimeAsync(9000);
  expect(listener).toHaveBeenCalledTimes(calls);
  storage.get.mockResolvedValue(undefined);
  await vi.advanceTimersByTimeAsync(3000);
  expect(manager.getSnapshot().task).toBeUndefined();
  expect(listener).toHaveBeenCalledTimes(calls + 1);
  manager.setOwner(null);
});
