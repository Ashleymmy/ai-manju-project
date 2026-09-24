import { describe, expect, it } from "vitest";
import { applyPromptInput, buildPromptEditor, buildPromptReferenceLayout, PROMPT_REFERENCE_DISPLAY as chip, promptDisplayOffset, promptRawSelection, separatePromptReferences } from "./promptEditor";

describe("video prompt reference lines", () => {
  it("packs short references together, preserving order and prompt text", () => {
    const value = "前@[ref:one] @[ref:two] 后";
    const normalized = separatePromptReferences(value).value;
    expect(normalized).toBe("前\n@[ref:one] @[ref:two]\n后");
    expect(separatePromptReferences(normalized).value).toBe(normalized);
  });

  it("gives short and long ids exactly the same compact footprint", () => {
    const model = buildPromptEditor("@[ref:short]\n@[ref:12345678-1234-1234-1234-123456789012]\n");
    expect(model.display).toBe(`${chip}\n${chip}\n`);
    expect(promptDisplayOffset(model, model.value.length)).toBe(model.display.length);
  });

  it("round trips every text boundary and snaps partial chip selections", () => {
    const model = buildPromptEditor("前\n@[ref:one]\n后");
    const segment = model.segments[0];
    expect(promptRawSelection(model, segment.start + 1, segment.end - 1)).toEqual({ start: 2, end: 12 });
    expect(promptRawSelection(model, segment.start + 1, segment.start + 1)).toEqual({ start: 2, end: 2 });
    for (const offset of [0, 1, 2, 12, 13, 14]) {
      const display = promptDisplayOffset(model, offset);
      expect(promptRawSelection(model, display, display).start).toBe(offset);
    }
  });

  it("preserves identical-looking references when editing a middle line", () => {
    const model = buildPromptEditor("@[ref:one]\n@[ref:two]\n@[ref:three]\n");
    const start = chip.length + 1;
    const next = model.display.slice(0, start) + "文字" + model.display.slice(start);
    expect(applyPromptInput(model, next, start + 2).value).toBe("@[ref:one]\n文字\n@[ref:two]\n@[ref:three]\n");
  });

  it("replaces a selected reference without corrupting neighboring media", () => {
    const model = buildPromptEditor("@[ref:one]\n@[ref:two]\n@[ref:three]\n");
    const start = chip.length + 1;
    const next = model.display.slice(0, start) + "替换" + model.display.slice(start + chip.length);
    expect(applyPromptInput(model, next, start + 2).value).toBe("@[ref:one]\n替换\n@[ref:three]\n");
  });

  it("leaves ordinary text, blank lines and IME input untouched", () => {
    const model = buildPromptEditor("第一行\n\n第二行");
    expect(applyPromptInput(model, "第一行\n\n第二行中", 10).value).toBe("第一行\n\n第二行中");
    expect(separatePromptReferences(model.value).value).toBe(model.value);
  });

  it("reflows old one-per-line references without imposing a fixed column count", () => {
    const tokens = Array.from({ length: 9 }, (_, index) => `@[ref:${index}]`);
    expect(separatePromptReferences(tokens.join("\n")).value).toBe(tokens.join(" ") + "\n");
    expect(separatePromptReferences("@[ref:a]\n\n@[ref:b]").value).toBe("@[ref:a]\n\n@[ref:b]\n");
  });

  it("isolates long visible labels instead of classifying by internal id length", () => {
    const layout = buildPromptReferenceLayout([
      { id: "long-id-but-short-label", token: "@图片1", name: "name" },
      { id: "b", name: "一个包含了完整场景描述的很长的参考素材名称" },
    ]);
    expect(layout.get("long-id-but-short-label")?.long).toBe(false);
    expect(layout.get("b")?.long).toBe(true);
    const raw = "@[ref:long-id-but-short-label] @[ref:b] @[ref:c] @[ref:d]";
    const result = separatePromptReferences(raw, raw.length, layout);
    expect(result.value).toBe("@[ref:long-id-but-short-label]\n@[ref:b]\n@[ref:c] @[ref:d]\n");
    expect(result.caret).toBe(result.value.length);
    expect(separatePromptReferences(result.value, undefined, layout).value).toBe(result.value);
  });

  it("caps long labels to the input width and keeps selection mappings intact", () => {
    const layout = buildPromptReferenceLayout([{ id: "long", name: "long reference name ".repeat(10) }], 24);
    const model = buildPromptEditor("@[ref:long]\n后", layout);
    expect(model.segments[0].end).toBe(24);
    expect(promptDisplayOffset(model, 11)).toBe(24);
    expect(promptRawSelection(model, 24, 25)).toEqual({ start: 11, end: 12 });
  });

  it("preserves a line break entered by the user between compact references", () => {
    const model = buildPromptEditor("@[ref:a] @[ref:b]\n");
    const display = `${chip}\n ${chip}\n`;
    expect(applyPromptInput(model, display, chip.length + 1).value).toBe("@[ref:a]\n@[ref:b]\n");
  });
});
