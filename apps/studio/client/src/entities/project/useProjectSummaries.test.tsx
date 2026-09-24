// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/http";
import type { WorkspaceScope } from "@/shared/config";
import { getProjectSummaries } from "./api";
import type { CanvasProjectSummary } from "./model";
import { useProjectSummaries, type VerifiedProjectSummary } from "./useProjectSummaries";
import { projectQueryKeys } from "./queries";

vi.mock("./api", () => ({ getProjectSummaries: vi.fn() }));
const project = (id: string): CanvasProjectSummary => ({ id, title: id, created_at: "", updated_at: "" });
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let current: ReturnType<typeof useProjectSummaries>;
function Probe({ scope, user, verified }: { scope: WorkspaceScope; user: string; verified?: VerifiedProjectSummary }) {
  current = useProjectSummaries(scope, user, verified);
  return null;
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(scope: WorkspaceScope = "personal", user = "user-a", verified?: VerifiedProjectSummary) {
  await act(async () => root.render(<QueryClientProvider client={client}><Probe scope={scope} user={user} verified={verified} /></QueryClientProvider>));
  await settle();
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(getProjectSummaries).mockReset();
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); vi.unstubAllGlobals(); });

it("distinguishes loading, failure and successful empty lists, and supports retry", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(getProjectSummaries).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await render();
  expect(current.loading).toBe(true);
  expect(current.error).toBe("");
  await act(async () => reject(new Error("bad list")));
  await settle();
  expect(current.loading).toBe(false);
  expect(current.error).toContain("重试");
  vi.mocked(getProjectSummaries).mockResolvedValueOnce([]);
  await act(async () => { await current.refresh(); });
  await settle();
  expect(current.projects).toEqual([]);
  expect(current.error).toBe("");
});

it("preserves previous projects on refresh failure and replaces them on recovery", async () => {
  vi.mocked(getProjectSummaries).mockResolvedValueOnce([project("old-canvas")]);
  await render();
  vi.mocked(getProjectSummaries).mockRejectedValueOnce(new Error("offline"));
  await act(async () => { await current.refresh(); });
  await settle();
  expect(current.projects.map(item => item.id)).toEqual(["old-canvas"]);
  expect(current.error).toContain("重试");
  vi.mocked(getProjectSummaries).mockResolvedValueOnce([project("old-canvas"), project("new-canvas")]);
  await act(async () => { await current.refresh(); });
  await settle();
  expect(current.projects).toHaveLength(2);
  expect(current.error).toBe("");
});

it("isolates accounts and workspaces and ignores a late response from the previous space", async () => {
  let finish!: (items: CanvasProjectSummary[]) => void;
  vi.mocked(getProjectSummaries).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  const signal = vi.mocked(getProjectSummaries).mock.calls[0][1]!;
  vi.mocked(getProjectSummaries).mockResolvedValueOnce([project("team")]);
  await render("team");
  expect(signal.aborted).toBe(true);
  await act(async () => finish([project("private-a")]));
  await settle();
  expect(current.projects.map(item => item.id)).toEqual(["team"]);
  vi.mocked(getProjectSummaries).mockRejectedValueOnce(new Error("offline"));
  await render("personal", "user-b");
  expect(current.projects).toEqual([]);
  expect(current.error).toContain("重试");
});

it("bounds transient retries and does not retry authorization errors", async () => {
  vi.mocked(getProjectSummaries).mockRejectedValue(new ApiError("unavailable", 503));
  await render();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
  await settle();
  expect(getProjectSummaries).toHaveBeenCalledTimes(2);
  expect(current.error).toContain("重试");
  vi.mocked(getProjectSummaries).mockRejectedValue(new ApiError("forbidden", 403));
  await render("team");
  expect(getProjectSummaries).toHaveBeenCalledTimes(3);
  expect(current.refreshing).toBe(false);
});

it("cancels an old list before a local mutation and stores metadata only", async () => {
  vi.mocked(getProjectSummaries).mockResolvedValueOnce([project("old")]);
  await render();
  let finish!: (items: CanvasProjectSummary[]) => void;
  vi.mocked(getProjectSummaries).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => { void current.refresh(); });
  const signal = vi.mocked(getProjectSummaries).mock.calls.at(-1)![1]!;
  vi.mocked(getProjectSummaries).mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => { await current.setProjects(items => [{ ...project("created"), data: { nodes: [] } }, ...items]); });
  await act(async () => finish([project("old")]));
  await settle();
  expect(signal.aborted).toBe(true);
  expect(current.projects.map(item => item.id)).toEqual(["created", "old"]);
  expect(current.projects[0]).not.toHaveProperty("data");
});

it("keeps the verified current canvas on an empty successful list without pretending the list is complete", async () => {
  const verified = { project: project("current"), scope: "personal" as const, userId: "user-a" };
  vi.mocked(getProjectSummaries).mockResolvedValueOnce([]);
  await render("personal", "user-a", verified);
  expect(current.projects.map(item => item.id)).toEqual(["current"]);
  expect(current.warning).toContain("列表暂不完整");
  expect(current.hasCachedList).toBe(false);
  expect(client.getQueryData(projectQueryKeys.summaries("personal", "user-a"))).toEqual([]);
  vi.mocked(getProjectSummaries).mockResolvedValueOnce([project("current"), project("old")]);
  await act(async () => { await current.refresh(); });
  await settle();
  expect(current.projects.map(item => item.id)).toEqual(["current", "old"]);
  expect(current.warning).toBe("");
});

it("keeps detail metadata through a failed list but never leaks it to another account, space or canvas", async () => {
  const verified = { project: project("current"), scope: "personal" as const, userId: "user-a" };
  vi.mocked(getProjectSummaries).mockRejectedValue(new Error("list failed"));
  await render("personal", "user-a", verified);
  expect(current.projects.map(item => item.id)).toEqual(["current"]);
  expect(current.error).toContain("重试");
  expect(current.warning).toBe("");
  expect(current.hasCachedList).toBe(false);
  await render("team", "user-a", verified);
  expect(current.projects).toEqual([]);
  await render("personal", "user-b", verified);
  expect(current.projects).toEqual([]);
  await render("personal", "user-a");
  expect(current.projects).toEqual([]);
});
