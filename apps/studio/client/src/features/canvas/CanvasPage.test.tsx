// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProjects: vi.fn(), navigate: vi.fn(), error: vi.fn(), location: "/canvas", search: "resume=recent" }));
vi.mock("wouter", () => ({ useLocation: () => [mocks.location, mocks.navigate], useSearch: () => mocks.search }));
vi.mock("@/entities/project", () => ({ getProjects: mocks.getProjects }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("@/pages/CanvasWorkspaceView", () => ({ default: () => <div>Canvas workspace</div> }));
import CanvasPage from "./CanvasPage";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.location = "/canvas";
  mocks.search = "resume=recent";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("recent canvas entry", () => {
  it.each([true, false])("opens the most recently saved canvas with array response=%s", async arrayResponse => {
    const projects = [
      { id: "older", updated_at: "2026-09-01T12:00:00Z" },
      { id: "newest / canvas", updated_at: "2026-09-20T12:00:00Z", scope: "personal" },
      { id: "last", updated_at: "2026-09-10T12:00:00Z" },
    ];
    mocks.getProjects.mockResolvedValue(arrayResponse ? projects : { items: projects, total: 3 });
    await act(async () => root.render(<CanvasPage />));
    expect(mocks.getProjects).toHaveBeenCalledWith("personal");
    expect(mocks.navigate).toHaveBeenCalledWith("/canvas/newest%20%2F%20canvas?scope=personal", { replace: true });
    expect(projects[0].id).toBe("older");
  });

  it("preserves workspace scope and falls back to creation time for legacy projects", async () => {
    mocks.search = "resume=recent&scope=team";
    mocks.getProjects.mockResolvedValue([
      { id: "older", updated_at: "invalid", created_at: "2026-09-01T00:00:00Z" },
      { id: "team-project", created_at: "2026-09-20T00:00:00Z", scope: "team" },
    ]);
    await act(async () => root.render(<CanvasPage />));
    expect(mocks.getProjects).toHaveBeenCalledWith("team");
    expect(mocks.navigate).toHaveBeenCalledWith("/canvas/team-project?scope=team", { replace: true });
  });

  it("opens the existing empty project list without creating a project", async () => {
    mocks.getProjects.mockResolvedValue({ items: [], total: 0 });
    await act(async () => root.render(<CanvasPage />));
    expect(mocks.navigate).toHaveBeenCalledWith("/canvas?scope=personal", { replace: true });
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("surfaces request failure and returns to the list without a redirect loop", async () => {
    mocks.getProjects.mockRejectedValue(new Error("Unavailable"));
    await act(async () => root.render(<CanvasPage />));
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/canvas?scope=personal", { replace: true });
  });

  it.each(["resolve", "reject"])("ignores a late %s after leaving the entry", async action => {
    let resolve!: (result: unknown) => void;
    let reject!: (error: unknown) => void;
    mocks.getProjects.mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
    await act(async () => root.render(<CanvasPage />));
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => root.render(null));
    await act(async () => {
      if (action === "resolve") resolve([{ id: "late" }]);
      else reject(new Error("late"));
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each([["/canvas", "scope=personal"], ["/canvas", ""], ["/canvas/chosen", "resume=recent"]])("leaves explicit list and project routes unchanged: %s?%s", async (location, search) => {
    mocks.location = location;
    mocks.search = search;
    await act(async () => root.render(<CanvasPage />));
    expect(container.textContent).toBe("Canvas workspace");
    expect(mocks.getProjects).not.toHaveBeenCalled();
  });
});
