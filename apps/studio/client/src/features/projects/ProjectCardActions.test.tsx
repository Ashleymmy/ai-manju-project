// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectCoverPickerDialog } from "@/components/ProjectCoverPickerDialog";
import type { CanvasProject } from "@/entities/project";

const mocks = vi.hoisted(() => ({
  getProjects: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getAssetContentObjectUrl: vi.fn(),
  navigate: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock("wouter", () => ({ useLocation: () => ["/", mocks.navigate] }));
vi.mock("sonner", () => ({
  toast: {
    success: mocks.success,
    warning: mocks.warning,
    error: mocks.error,
  },
}));
vi.mock("@/entities/project", () => ({
  getProjects: mocks.getProjects,
  updateProject: mocks.updateProject,
  deleteProject: mocks.deleteProject,
}));
vi.mock("@/entities/asset", () => ({
  getAssetLibrary: async () => [],
  getAssetContentObjectUrl: mocks.getAssetContentObjectUrl,
}));
vi.mock("@/entities/comic", () => ({ listComicProjects: async () => [] }));
vi.mock("@/entities/job", () => ({ getJobs: async () => [] }));
vi.mock("@/features/chat", () => ({ ChatComposer: () => null }));
vi.mock("@/features/member", () => ({
  useMemberOverviewQuery: () => ({}),
  useMemberConsumptionsQuery: () => ({ data: { items: [] } }),
  formatCredits: String,
}));
vi.mock("@/components/ProjectCoverPickerDialog", () => ({
  ProjectCoverPickerDialog: (
    props: ComponentProps<typeof ProjectCoverPickerDialog>
  ) =>
    props.open ? (
      <div
        role="dialog"
        data-cover={props.currentCoverAssetId}
        data-scope={props.scope}
      >
        <button onClick={() => props.onSelect("new-cover")}>
          Choose cover
        </button>
        <button onClick={() => props.onSelect("")}>Reset cover</button>
        <button onClick={props.onClose}>Close picker</button>
      </div>
    ) : null,
}));

import DashboardPage from "@/features/dashboard/DashboardPage";
import ProjectsPage from "./ProjectsPage";

describe.each([
  { name: "dashboard", Page: DashboardPage, visibleCount: 3 },
  { name: "archive", Page: ProjectsPage, visibleCount: 4 },
])("$name project card actions", ({ name, Page, visibleCount }) => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let projects: CanvasProject[];

  async function flush() {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  async function mount() {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Page />
        </QueryClientProvider>
      )
    );
    await flush();
  }

  function card(index = 0) {
    return container.querySelectorAll<HTMLDivElement>(".project-card-wrap")[
      index
    ];
  }

  async function click(element: HTMLElement) {
    await act(async () => element.click());
    await flush();
  }

  async function action(title: string, index = 0) {
    await click(
      card(index).querySelector<HTMLButtonElement>(`button[title="${title}"]`)!
    );
  }

  async function pickerAction(text: string) {
    const button = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[role="dialog"] button'
      ),
    ].find(item => item.textContent === text)!;
    await click(button);
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("prompt", vi.fn().mockReturnValue(null));
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    vi.stubGlobal(
      "URL",
      class extends URL {
        static revokeObjectURL = vi.fn();
      }
    );
    projects = Array.from({ length: 4 }, (_, index) => ({
      id: `project-${index + 1}`,
      title: `Canvas ${index + 1}`,
      cover_asset_id: index === 1 ? "old-cover" : "",
      created_at: "2026-09-20T00:00:00Z",
      updated_at: "2026-09-20T00:00:00Z",
    }));
    mocks.getProjects.mockImplementation(async () => ({
      items: [...projects],
      total: projects.length,
    }));
    mocks.updateProject.mockImplementation(async (id, patch) => {
      projects = projects.map(project =>
        project.id === id ? { ...project, ...patch } : project
      );
      return projects.find(project => project.id === id);
    });
    mocks.deleteProject.mockImplementation(async id => {
      projects = projects.filter(project => project.id !== id);
    });
    mocks.getAssetContentObjectUrl.mockImplementation(async id => `blob:${id}`);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("provides three independent tools per card and preserves card navigation", async () => {
    await mount();
    expect(container.querySelectorAll(".project-card-tools")).toHaveLength(
      visibleCount
    );
    expect(
      [...card().querySelectorAll(".project-card-tools button")].map(button =>
        button.getAttribute("aria-label")
      )
    ).toEqual(["设置封面", "重命名", "删除"]);
    expect(container.querySelector("button button")).toBeNull();
    await click(card().querySelector<HTMLButtonElement>(".project-card")!);
    expect(mocks.navigate).toHaveBeenCalledWith("/canvas/project-1");
  });

  it("persists the selected card's trimmed name and refreshes it without navigating", async () => {
    await mount();
    vi.mocked(window.prompt).mockReturnValue("  Renamed canvas  ");
    await action("重命名", 1);
    expect(window.prompt).toHaveBeenCalledWith("项目名称", "Canvas 2");
    expect(mocks.updateProject).toHaveBeenCalledWith("project-2", {
      title: "Renamed canvas",
      scope: "personal",
    });
    expect(card(1).querySelector("h3")?.textContent).toBe("Renamed canvas");
    expect(mocks.success).toHaveBeenCalledWith("项目已重命名");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("ignores cancelled, blank and unchanged names", async () => {
    await mount();
    for (const title of [null, "   ", " Canvas 1 "]) {
      vi.mocked(window.prompt).mockReturnValue(title);
      await action("重命名");
    }
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("persists cover selection and reset and refreshes the thumbnail", async () => {
    await mount();
    await action("设置封面", 1);
    expect(
      container.querySelector('[role="dialog"]')?.getAttribute("data-cover")
    ).toBe("old-cover");
    expect(
      container.querySelector('[role="dialog"]')?.getAttribute("data-scope")
    ).toBe("personal");
    await pickerAction("Choose cover");
    expect(mocks.updateProject).toHaveBeenCalledWith("project-2", {
      cover_asset_id: "new-cover",
      scope: "personal",
    });
    expect(card(1).querySelector("img")?.getAttribute("src")).toBe(
      "blob:new-cover"
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await action("设置封面", 1);
    await pickerAction("Reset cover");
    expect(mocks.updateProject).toHaveBeenLastCalledWith("project-2", {
      cover_asset_id: "",
      scope: "personal",
    });
    expect(card(1).querySelector("img")).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("reports failed edits without changing the card or closing the cover picker", async () => {
    await mount();
    mocks.updateProject.mockRejectedValue(new Error("offline"));
    vi.mocked(window.prompt).mockReturnValue("Not saved");
    await action("重命名", 1);
    expect(card(1).querySelector("h3")?.textContent).toBe("Canvas 2");
    await action("设置封面", 1);
    await pickerAction("Choose cover");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(card(1).querySelector("img")?.getAttribute("src")).toBe(
      "blob:old-cover"
    );
    expect(mocks.error).toHaveBeenCalledTimes(2);
    expect(mocks.success).not.toHaveBeenCalled();
    await pickerAction("Close picker");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("only deletes after confirmation, reloads the list and refreshes the dashboard count", async () => {
    await mount();
    await action("删除", 1);
    expect(mocks.deleteProject).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    await action("删除", 1);
    expect(window.confirm).toHaveBeenLastCalledWith(
      "删除 1 个画布项目及其快照？此操作不可恢复。"
    );
    expect(mocks.deleteProject).toHaveBeenCalledWith("project-2", "personal");
    expect(
      [...container.querySelectorAll(".project-card h3")].map(
        item => item.textContent
      )
    ).toEqual(["Canvas 1", "Canvas 3", "Canvas 4"]);
    if (name === "dashboard") {
      await flush();
      expect(
        container.querySelector(".stat-strip > div:last-child strong")
          ?.textContent
      ).toBe("03");
    }
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("retains a project when deletion fails and reports the failure", async () => {
    await mount();
    vi.mocked(window.confirm).mockReturnValue(true);
    mocks.deleteProject.mockRejectedValue(new Error("offline"));
    await action("删除");
    expect(card().querySelector("h3")?.textContent).toBe("Canvas 1");
    expect(mocks.warning).toHaveBeenCalledWith("删除完成，1 个失败");
  });

  if (name === "archive") {
    it("preserves bulk selection on cancellation and clears it after a partially successful deletion", async () => {
      await mount();
      await click(
        card().querySelector<HTMLInputElement>('input[type="checkbox"]')!
      );
      await click(
        card(1).querySelector<HTMLInputElement>('input[type="checkbox"]')!
      );
      const bulkDelete = container.querySelector<HTMLButtonElement>(
        ".project-bulk-bar button"
      )!;
      await click(bulkDelete);
      expect(container.querySelectorAll("input:checked")).toHaveLength(2);
      expect(mocks.deleteProject).not.toHaveBeenCalled();
      vi.mocked(window.confirm).mockReturnValue(true);
      mocks.deleteProject.mockRejectedValueOnce(new Error("offline"));
      await click(bulkDelete);
      expect(mocks.deleteProject.mock.calls).toEqual([
        ["project-1", "personal"],
        ["project-2", "personal"],
      ]);
      expect(container.querySelectorAll("input:checked")).toHaveLength(0);
      expect(card().querySelector("h3")?.textContent).toBe("Canvas 1");
      expect(mocks.warning).toHaveBeenCalledWith("删除完成，1 个失败");
    });
  }
});
