import { describe, expect, it } from "vitest";

import { buildPromptLibraryEntries, filterPromptLibraryEntries } from "./prompt-library";

describe("prompt library", () => {
  const entries = buildPromptLibraryEntries(
    [{ id: "system-1", title: "系统镜头", prompt: "雨夜推镜", tags: ["镜头"], category: "电影" }],
    [
      { id: "normal", title: "普通预设", prompt: "普通", tags: [], priority: "normal", sort_order: 2, createdAt: "", updatedAt: "" },
      { id: "pinned", title: "置顶预设", prompt: "冷色侦探", tags: ["人物"], priority: "pinned", sort_order: 1, createdAt: "", updatedAt: "" },
    ],
  );

  it("合并系统与个人提示词，并优先排列置顶个人预设", () => {
    expect(entries.map((item) => [item.source, item.title])).toEqual([
      ["personal", "置顶预设"],
      ["personal", "普通预设"],
      ["system", "系统镜头"],
    ]);
  });

  it("按标题、正文、分类和标签搜索", () => {
    expect(filterPromptLibraryEntries(entries, "侦探").map((item) => item.title)).toEqual(["置顶预设"]);
    expect(filterPromptLibraryEntries(entries, "电影").map((item) => item.title)).toEqual(["系统镜头"]);
  });
});
