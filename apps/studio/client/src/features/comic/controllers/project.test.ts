import { beforeEach, describe, expect, it, vi } from "vitest";

const comicApiMocks = vi.hoisted(() => ({
  createComicProject: vi.fn(),
  deleteComicProject: vi.fn(),
  downloadComicProjectSource: vi.fn(),
  getComicProject: vi.fn(),
  updateComicProject: vi.fn(),
}));

vi.mock("@/entities/comic", () => comicApiMocks);

import { createEmptyComicProject } from "./project";

describe("Comic project controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an empty project with only the supported contract fields", () => {
    createEmptyComicProject(
      { title: "  第一季  ", stylePreset: "  国风  " },
      "team"
    );

    expect(comicApiMocks.createComicProject).toHaveBeenCalledOnce();
    expect(comicApiMocks.createComicProject).toHaveBeenCalledWith(
      { title: "第一季", style_preset: "国风" },
      "team"
    );
  });
});
