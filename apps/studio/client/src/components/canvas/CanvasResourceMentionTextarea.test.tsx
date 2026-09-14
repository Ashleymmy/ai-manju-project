// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCanvasMentionEditorModel, type CanvasMentionReference } from "@/features/canvas/domain/mentions";
import { CanvasResourceMentionTextarea } from "./CanvasResourceMentionTextarea";
import { emptyCanvasMentionLibrary, type CanvasMentionLibraryState, type CanvasMentionLibraryTarget } from "@/features/canvas/domain/mentionLibrary";
import type { AssetFolder } from "@/entities/asset";

const references: CanvasMentionReference[] = [{
  id: "text-1", key: "node:text-1", source: "node", group: "canvas-node",
  targetId: "text-1", nodeId: "text-1", kind: "text", label: "文本1",
  title: "雪景描述", searchText: "雪景描述", active: true,
}];

describe("canvas prompt editor value synchronization", () => {
  let root: Root;
  let container: HTMLDivElement;
  let onChange: ReturnType<typeof vi.fn<(value: string) => void>>;

  async function render(value: string) {
    await act(async () => root.render(
      <CanvasResourceMentionTextarea value={value} references={references} onChange={onChange} />
    ));
  }

  function textarea() { return container.querySelector("textarea")!; }

  async function input(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), value);
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onChange = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([
    ["plain text", "生成一个冬天雪景：广阔宁静的雪地。"],
    ["text with a node reference", "@[node:text-1]\n生成一个冬天雪景：广阔宁静的雪地。"],
  ])("restores %s after selecting a new empty node and returning", async (_name, original) => {
    const display = buildCanvasMentionEditorModel(original, references).displayValue;
    await render(original);
    expect(textarea().value).toBe(display);
    await render("");
    expect(textarea().value).toBe("");
    await render(original);
    expect(textarea().value).toBe(display);
    expect(onChange).not.toHaveBeenCalled();

    // Continue typing in the restored node: earlier text and canonical @ tokens survive.
    await input(`${textarea().value} 冷色调自然光。`);
    expect(onChange).toHaveBeenLastCalledWith(`${original} 冷色调自然光。`);
    await render(`${original} 冷色调自然光。`);
    expect(textarea().value).toBe(`${display} 冷色调自然光。`);
    if (original.includes("@[")) {
      expect(container.querySelector(".canvas-mention-overlay")?.textContent).toContain("文本1");
    }
  });

  it("shows asynchronously loaded content in an initially empty editor", async () => {
    await render("");
    await render("从画布快照加载的提示词");
    expect(textarea().value).toBe("从画布快照加载的提示词");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("supports clearing content and restoring it with undo", async () => {
    await render("需要保留的原始提示词");
    await input("");
    expect(onChange).toHaveBeenLastCalledWith("");
    await render("");
    await render("需要保留的原始提示词");
    expect(textarea().value).toBe("需要保留的原始提示词");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("canvas mention folder popup", () => {
  let root: Root;
  let container: HTMLDivElement;
  let requests: ReturnType<typeof vi.fn>;
  const folder = (id: string, parent_id: string, name: string, extra: Partial<AssetFolder> = {}): AssetFolder => ({ id, parent_id, name, kind: "system", asset_count: 0, descendant_asset_count: 0, sort_order: 0, ...extra });
  const library: CanvasMentionLibraryState = {
    ...emptyCanvasMentionLibrary("project-1"),
    folders: [
      folder("root", "", "系统归档", { system_key: "system_root" }), folder("canvas", "root", "画布工坊"),
      folder("mine", "canvas", "第一集分镜", { system_key: "canvas_project", source_ref_id: "project-1" }),
      folder("roles", "mine", "角色", { sort_order: 10 }), folder("scenes", "mine", "场景", { sort_order: 20 }), folder("props", "mine", "道具", { sort_order: 30 }),
      folder("unfiled", "root", "未分类"),
    ],
  };
  const menuReferences: CanvasMentionReference[] = [
    { ...references[0], label: "前置文本", upstreamDistance: 1 },
    { ...references[0], id: "asset:hero", key: "asset:hero", source: "asset", group: "asset-library", targetId: "hero", nodeId: undefined, assetId: "hero", assetScope: "personal", label: "主角设定" },
  ];
  function Harness() {
    const [value, setValue] = useState("");
    const [catalog, setCatalog] = useState(library);
    const load = (query: string, target: CanvasMentionLibraryTarget = "root", more = false) => {
      requests(query, target, more);
      setCatalog({ ...library, target, query, assetIds: target === "folder:roles" || target === "favorites" ? ["hero"] : [] });
    };
    return <CanvasResourceMentionTextarea value={value} onChange={setValue} references={menuReferences} mentionLibrary={catalog} onMentionQueryChange={load} />;
  }
  const rows = () => [...document.querySelectorAll(".canvas-mention-item strong")].map(item => item.textContent);
  async function press(key: string) {
    await act(async () => container.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
  }
  async function click(label: string) {
    const row = [...document.querySelectorAll(".canvas-mention-item, .canvas-mention-back")].find(item => item.textContent?.includes(label));
    expect(row, label).toBeTruthy();
    await act(async () => row!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true })));
  }
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    requests = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
    await act(async () => {
      const textarea = container.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "@");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders the requested order and navigates folders without changing the prompt", async () => {
    expect(rows()).toEqual(["前置文本", "第一集分镜", "收藏夹", "系统归档"]);
    await click("第一集分镜");
    expect(rows()).toEqual(["前置文本", "角色", "场景", "道具"]);
    expect(container.querySelector("textarea")!.value).toBe("@");
    await click("角色");
    expect(rows()).toEqual(["前置文本", "主角设定"]);
    expect(requests).toHaveBeenLastCalledWith("", "folder:roles", false);
    await click("主角设定");
    expect(document.querySelector(".canvas-mention-menu")).toBeNull();
    expect(container.querySelector("textarea")!.value).toContain("主角设定");
  });

  it("supports keyboard folder navigation, backtracking and favorites", async () => {
    await press("ArrowDown");
    await press("Enter");
    expect(rows()).toContain("角色");
    await press("Escape");
    expect(rows()).toEqual(["前置文本", "第一集分镜", "收藏夹", "系统归档"]);
    await click("收藏夹");
    expect(rows()).toEqual(["前置文本", "主角设定"]);
    expect(requests).toHaveBeenLastCalledWith("", "favorites", false);
  });

  it("closes on a canvas press that prevents blur and stops propagation, preserving the prompt", async () => {
    const outside = document.createElement("div");
    outside.addEventListener("pointerdown", event => { event.preventDefault(); event.stopPropagation(); });
    container.append(outside);
    await act(async () => outside.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true })));
    expect(document.querySelector(".canvas-mention-menu")).toBeNull();
    expect(container.querySelector("textarea")!.value).toBe("@");
  });

  it("opens system archive directly from the first level and returns there in one step", async () => {
    expect(document.querySelector(".canvas-mention-menu")?.textContent).not.toContain("其他资产库");
    await click("系统归档");
    expect(requests).toHaveBeenLastCalledWith("", "folder:root", false);
    expect(rows()).toContain("未分类");
    await click("未分类");
    expect(document.querySelector(".canvas-mention-menu")?.textContent).toContain("此文件夹暂无匹配的素材");
    await click("返回");
    expect(rows()).toContain("未分类");
    await click("返回");
    expect(rows()).toEqual(["前置文本", "第一集分镜", "收藏夹", "系统归档"]);
  });
});
