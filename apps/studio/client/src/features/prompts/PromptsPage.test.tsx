// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PromptPreset } from "@/entities/prompt";

const presets: PromptPreset[] = ["aaa", "bbb", "ccc"].map((title, index) => ({
  id: `p-${title}`,
  title,
  prompt: `${title} 提示词`,
  tags: [],
  priority: "normal",
  sort_order: index,
  createdAt: "2026-10-20T00:00:00Z",
  updatedAt: "2026-10-20T00:00:00Z",
}));

const updatePreferences = vi.fn(
  async (input: { canvas: { promptPresets: PromptPreset[] } }) => ({
    canvas: { promptPresets: input.canvas.promptPresets },
  })
);

vi.mock("@/features/settings", () => ({
  settingsQueryKeys: { preferences: () => ["preferences"] },
  updatePreferences: (input: { canvas: { promptPresets: PromptPreset[] } }) =>
    updatePreferences(input),
  usePreferencesQuery: () => ({
    isPending: false,
    error: null,
    data: { canvas: { promptPresets: presets } },
  }),
}));
vi.mock("./model/queries", () => ({
  usePromptSemanticTagsQuery: () => ({ data: [] }),
  useSystemPromptLibraryQuery: () => ({ isPending: true, isFetching: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PromptLibraryView } from "./PromptsPage";

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <PromptLibraryView />
      </QueryClientProvider>
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const selectedTitle = () =>
  container.querySelector(".template-card.selected b")?.textContent;
const card = (title: string) =>
  [...container.querySelectorAll<HTMLButtonElement>(".template-card")].find(
    item => item.querySelector("b")?.textContent === title
  )!;
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(item =>
    item.textContent?.includes(label)
  )!;

it("keeps the edited preset selected after saving instead of jumping to the first", async () => {
  expect(selectedTitle()).toBe("aaa");
  await act(async () => card("ccc").click());
  expect(selectedTitle()).toBe("ccc");
  await act(async () => button("保存预设").click());
  expect(updatePreferences).toHaveBeenCalled();
  expect(selectedTitle()).toBe("ccc");
});

it("selects the first remaining preset only after the selected one is deleted", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await act(async () => card("bbb").click());
  await act(async () => button("删除预设").click());
  expect(card("bbb")).toBeUndefined();
  expect(selectedTitle()).toBe("aaa");
});
