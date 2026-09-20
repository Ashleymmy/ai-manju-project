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

describe("canvas image mention caret", () => {
  let root: Root;
  let container: HTMLDivElement;
  let changed: ReturnType<typeof vi.fn>;
  let preview: ReturnType<typeof vi.fn>;
  let submit: ReturnType<typeof vi.fn>;
  const imageReferences: CanvasMentionReference[] = ["a", "b"].map(id => ({
    id, key: `node:${id}`, source: "node", group: "canvas-node", targetId: id, nodeId: id,
    kind: "image", label: `图片${id}`, title: id, searchText: id, active: true, upstreamDistance: 1,
  }));
  const original = "@[node:a] @[node:b] 生成企鹅";
  function Harness({ initial = original }: { initial?: string }) {
    const [value, setValue] = useState(initial);
    return <CanvasResourceMentionTextarea value={value} references={imageReferences}
      onChange={next => { changed(next); setValue(next); }} onPreviewReference={preview} onSubmit={submit} />;
  }
  const textarea = () => container.querySelector("textarea")!;
  async function key(value: string, extra: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra });
    await act(async () => textarea().dispatchEvent(event));
    return event;
  }
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    changed = vi.fn(); preview = vi.fn(); submit = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
    await act(async () => textarea().focus());
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("crosses each thumbnail in one arrow press from either boundary without snapping back", async () => {
    const { segments } = buildCanvasMentionEditorModel(original, imageReferences);
    for (const segment of segments) {
      textarea().setSelectionRange(segment.start, segment.start);
      expect((await key("ArrowRight")).defaultPrevented).toBe(true);
      expect(textarea().selectionStart).toBe(segment.end);
      await act(async () => document.dispatchEvent(new Event("selectionchange")));
      expect(textarea().selectionStart).toBe(segment.end);
      expect((await key("ArrowLeft")).defaultPrevented).toBe(true);
      expect(textarea().selectionStart).toBe(segment.start);
    }
    expect(changed).not.toHaveBeenCalled();
  });

  it("extends and shrinks keyboard selections around entire references", async () => {
    const { segments: [first] } = buildCanvasMentionEditorModel(original, imageReferences);
    textarea().setSelectionRange(first.start, first.start);
    await key("ArrowRight", { shiftKey: true });
    expect([textarea().selectionStart, textarea().selectionEnd]).toEqual([first.start, first.end]);
    await key("ArrowLeft", { shiftKey: true });
    expect([textarea().selectionStart, textarea().selectionEnd]).toEqual([first.start, first.start]);
    textarea().setSelectionRange(first.end, first.end);
    await key("ArrowLeft", { shiftKey: true });
    expect(textarea().selectionDirection).toBe("backward");
    expect([textarea().selectionStart, textarea().selectionEnd]).toEqual([first.start, first.end]);
  });

  it("positions the caret on either side by mouse and reserves preview for double click", async () => {
    const chip = container.querySelector<HTMLElement>(".mention-chip-thumb-only")!;
    vi.spyOn(chip, "getBoundingClientRect").mockReturnValue({ left: 100, width: 24 } as DOMRect);
    await act(async () => chip.dispatchEvent(new MouseEvent("pointerdown", { clientX: 120, button: 0, bubbles: true, cancelable: true })));
    expect(textarea().selectionStart).toBe(buildCanvasMentionEditorModel(original, imageReferences).segments[0].end);
    await act(async () => chip.click());
    expect(preview).not.toHaveBeenCalled();
    await act(async () => chip.dispatchEvent(new MouseEvent("pointerdown", { clientX: 101, button: 0, bubbles: true, cancelable: true })));
    expect(textarea().selectionStart).toBe(0);
    await act(async () => chip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })));
    expect(preview).toHaveBeenCalledWith(imageReferences[0]);
  });

  it("deletes the intended thumbnail atomically and keeps the other reference and following text", async () => {
    const { segments: [first] } = buildCanvasMentionEditorModel(original, imageReferences);
    textarea().setSelectionRange(first.end, first.end);
    await key("Backspace");
    expect(changed.mock.lastCall?.[0]).not.toContain("@[node:a]");
    expect(changed.mock.lastCall?.[0]).toContain("@[node:b]");
    expect(changed.mock.lastCall?.[0]).toContain("生成企鹅");
    expect(textarea().selectionStart).toBe(first.start);
  });

  it.each(["Backspace", "Delete"])("%s removes an adjacent image with its built-in spacing in one step", async deleteKey => {
    const initial = "前@[node:a]@[node:b]后";
    await act(async () => root.render(<Harness key={deleteKey} initial={initial} />));
    const { segments: [first, second] } = buildCanvasMentionEditorModel(initial, imageReferences);
    expect(first.end).toBe(second.start);
    const cursor = deleteKey === "Backspace" ? first.end : first.start;
    textarea().setSelectionRange(cursor, cursor);
    await key(deleteKey);
    expect(changed.mock.lastCall?.[0]).toBe("前@[node:b]后");
    expect(textarea().value).toBe(buildCanvasMentionEditorModel("前@[node:b]后", imageReferences).displayValue);
    expect(textarea().selectionStart).toBe(first.start);
  });

  it("does not submit or move the caret when confirming Chinese composition", async () => {
    await act(async () => textarea().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    textarea().setSelectionRange(0, 0);
    expect((await key("ArrowRight", { isComposing: true })).defaultPrevented).toBe(false);
    expect(textarea().selectionStart).toBe(0);
    await key("Enter", { isComposing: true });
    expect(submit).not.toHaveBeenCalled();
    await act(async () => textarea().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "企鹅" })));
    await key("Enter");
    expect(submit).not.toHaveBeenCalled();
    await key("Enter", { ctrlKey: true });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("inserts a newline on Enter and only submits via Ctrl/Cmd+Enter", async () => {
    const enter = await key("Enter");
    expect(submit).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
    expect((await key("Enter", { metaKey: true })).defaultPrevented).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    await key("Enter", { ctrlKey: true });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("deletes a selected reference without confusing identical thumbnail placeholders", async () => {
    const { segments: [first] } = buildCanvasMentionEditorModel(original, imageReferences);
    textarea().setSelectionRange(first.start, first.start);
    await key("ArrowRight", { shiftKey: true });
    await key("Backspace");
    expect(changed.mock.lastCall?.[0]).not.toContain("@[node:a]");
    expect(changed.mock.lastCall?.[0]).toContain("@[node:b]");
    expect(changed.mock.lastCall?.[0]).toContain("生成企鹅");
    expect(textarea().selectionStart).toBe(first.start);
  });

  it("keeps both references when typing between the thumbnails and the following prompt", async () => {
    const model = buildCanvasMentionEditorModel(original, imageReferences);
    const caret = model.segments[1].end;
    textarea().setSelectionRange(model.segments[1].start, model.segments[1].start);
    await key("ArrowRight");
    expect(textarea().selectionStart).toBe(caret);
    await act(async () => {
      const next = textarea().value.slice(0, caret) + "参考" + textarea().value.slice(caret);
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), next);
      textarea().setSelectionRange(caret + 2, caret + 2);
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(changed.mock.lastCall?.[0]).toContain("@[node:a]");
    expect(changed.mock.lastCall?.[0]).toContain("@[node:b]参考 生成企鹅");
    expect(textarea().selectionStart).toBe(caret + 2);
  });

  it("does not reinsert a deleted image gap or jump to the end when references refresh", async () => {
    function RefreshingHarness({ tick }: { tick: number }) {
      const [value, setValue] = useState(original);
      return <CanvasResourceMentionTextarea value={value} references={imageReferences.map(ref => ({ ...ref, title: `${ref.title}-${tick}` }))}
        onChange={next => { changed(next); setValue(next); }} />;
    }
    await act(async () => root.render(<RefreshingHarness tick={0} />));
    const before = buildCanvasMentionEditorModel(original, imageReferences);
    const gapPosition = before.segments[1].start - 1;
    const afterDeletion = before.displayValue.slice(0, gapPosition) + before.displayValue.slice(gapPosition + 1);
    await act(async () => {
      textarea().focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), afterDeletion);
      textarea().setSelectionRange(gapPosition, gapPosition);
      textarea().dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    });
    await act(async () => root.render(<RefreshingHarness tick={1} />));
    expect(textarea().value).toBe(afterDeletion);
    expect(textarea().selectionStart).toBe(gapPosition);
    expect(changed.mock.lastCall?.[0]).toContain("@[node:a]@[node:b]");
  });

  it("places the caret after an inserted image before the next keystroke without a deferred frame", async () => {
    await act(async () => root.render(<Harness key="insert" initial="" />));
    await act(async () => {
      textarea().focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), "@");
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await key("Enter");
    expect(changed.mock.lastCall?.[0]).toBe("@[node:a]");
    expect(textarea().selectionStart).toBe(textarea().value.length);
    expect(document.activeElement).toBe(textarea());
    expect(document.querySelector(".canvas-mention-menu")).toBeNull();
  });
});

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
      folder("root", "", "系统归档", { system_key: "system_root" }), folder("canvas", "root", "画布工坊", { sort_order: 40 }),
      folder("mine", "canvas", "第一集分镜", { system_key: "canvas_project", source_ref_id: "project-1" }),
      folder("roles", "mine", "角色", { sort_order: 10 }), folder("scenes", "mine", "场景", { sort_order: 20 }), folder("props", "mine", "道具", { sort_order: 30 }),
      folder("other", "mine", "其他", { sort_order: 70 }),
      folder("unfiled", "root", "未分类", { sort_order: 10 }),
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
    expect(rows()).toEqual(["前置文本", "第一集分镜", "收藏夹", "未分类", "画布工坊"]);
    await click("第一集分镜");
    expect(rows()).toEqual(["前置文本", "角色", "场景", "道具", "其他"]);
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
    expect(rows()).toEqual(["前置文本", "第一集分镜", "收藏夹", "未分类", "画布工坊"]);
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

  it("opens promoted archive children directly and returns to the first level in one step", async () => {
    expect(document.querySelector(".canvas-mention-menu")?.textContent).not.toContain("其他资产库");
    expect(document.querySelector(".canvas-mention-menu")?.textContent).not.toContain("系统归档");
    expect(rows()).toContain("未分类");
    await click("未分类");
    expect(requests).toHaveBeenLastCalledWith("", "folder:unfiled", false);
    expect(document.querySelector(".canvas-mention-menu")?.textContent).toContain("此文件夹暂无匹配的素材");
    await click("返回");
    expect(rows()).toEqual(["前置文本", "第一集分镜", "收藏夹", "未分类", "画布工坊"]);
  });
});
