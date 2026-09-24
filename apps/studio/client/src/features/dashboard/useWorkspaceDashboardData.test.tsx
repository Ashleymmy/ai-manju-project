// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getProjectSummaries } from "@/entities/project/api";
import { getJobs } from "@/entities/job";
import { useProjectSummaries } from "@/entities/project";
import { useWorkspaceDashboardData } from "./useWorkspaceDashboardData";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "qa" } }) }));
vi.mock("@/entities/project/api", async importOriginal => ({ ...await importOriginal<typeof import("@/entities/project/api")>(), getProjectSummaries: vi.fn() }));
vi.mock("@/entities/job", () => ({ getJobs: vi.fn() }));
vi.mock("@/entities/asset", () => ({ getAssetLibrary: async () => ({ items: [], total: 455 }) }));
vi.mock("@/entities/comic", () => ({ listComicProjects: async () => [] }));
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let current: ReturnType<typeof useWorkspaceDashboardData>;
let cards: ReturnType<typeof useProjectSummaries>;
function Probe() {
  current = useWorkspaceDashboardData();
  cards = useProjectSummaries("personal", "qa");
  return null;
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function mount() {
  await act(async () => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
  await settle();
}
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.resetAllMocks(); client = new QueryClient(); root = createRoot(document.createElement("div")); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); vi.unstubAllGlobals(); });
it("shares the list request and displays its count before unrelated slow statistics complete", async () => {
  vi.mocked(getProjectSummaries).mockResolvedValue([{ id: "old", title: "旧画布", created_at: "", updated_at: "" }]);
  vi.mocked(getJobs).mockImplementation(() => new Promise(() => {}));
  await mount();
  expect(current.data.projects).toMatchObject({ total: 1, state: "ready" });
  expect(current.data.jobs.state).toBe("loading");
  expect(cards.projects).toHaveLength(1);
  expect(getProjectSummaries).toHaveBeenCalledTimes(1);
});
it("never reports a failed initial list as zero projects", async () => {
  vi.mocked(getProjectSummaries).mockRejectedValue(new Error("timeout"));
  vi.mocked(getJobs).mockResolvedValue({ items: [], total: 0 });
  await mount();
  expect(current.data.projects).toMatchObject({ state: "error", total: undefined });
  expect(current.data.assets.total).toBe(455);
});
