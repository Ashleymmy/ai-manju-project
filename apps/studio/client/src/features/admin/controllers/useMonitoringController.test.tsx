// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: { id: "admin", role: "super_admin" },
  get: vi.fn(),
  users: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user }),
}));
vi.mock("../services/runtimeMonitoringApi", async importOriginal => ({
  ...(await importOriginal<object>()),
  getRuntimeMonitoring: mocks.get,
  getMonitoringUsers: mocks.users,
}));
import {
  useMonitoringController,
  type MonitoringController,
} from "./useMonitoringController";
let root: Root,
  client: QueryClient,
  latest: MonitoringController,
  container: HTMLDivElement;
let active = true;
function Harness() {
  latest = useMonitoringController(active);
  return null;
}
async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    );
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.user = { id: "admin", role: "super_admin" };
  active = true;
  mocks.get
    .mockReset()
    .mockImplementation(async filters => ({
      items: [{ id: filters.user_id || "global" }],
      generated_at: "now",
    }));
  mocks.users.mockReset().mockResolvedValue([]);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});
it("clears previous user's data immediately during scope changes", async () => {
  await render();
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  expect(latest.monitoring?.items[0].id).toBe("global");
  mocks.get.mockImplementation(() => new Promise(() => {}));
  await act(async () => latest.updateFilters({ user_id: "alice" }));
  expect(latest.monitoring).toBeNull();
  expect(mocks.get.mock.calls.at(-1)?.[0].user_id).toBe("alice");
});
it("forces own scope for members and never fetches user list", async () => {
  mocks.user = { id: "alice", role: "member" };
  await render();
  await act(async () => latest.updateFilters({ user_id: "bob" }));
  expect(latest.filters.user_id).toBe("alice");
  expect(mocks.users).not.toHaveBeenCalled();
  mocks.user = { id: "bob", role: "member" };
  mocks.get.mockImplementation(() => new Promise(() => {}));
  await render();
  expect(latest.monitoring).toBeNull();
  expect(latest.filters.user_id).toBe("bob");
});
it("does not query inactive monitoring and resets page on filters", async () => {
  active = false;
  await render();
  expect(mocks.get).not.toHaveBeenCalled();
  expect(latest.isPending).toBe(false);
  active = true;
  await render();
  await act(async () => latest.setPage(3));
  expect(latest.filters.page).toBe(3);
  await act(async () => latest.updateFilters({ source: "worker" }));
  expect(latest.filters.page).toBe(1);
});
