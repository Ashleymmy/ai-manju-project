import { describe, expect, it } from "vitest";
import {
  buildCanvasMentionEditorModel, replaceCanvasMentionEditorSelection, sliceCanvasMentionEditorSelection,
  type CanvasMentionReference,
} from "./mentions";

const references: CanvasMentionReference[] = ["a", "b"].map(id => ({
  id, key: `node:${id}`, source: "node", group: "canvas-node", targetId: id, kind: "image",
  label: id, title: id, searchText: id, active: true,
}));
const original = "前@[node:a]@[node:b]\n后";
const model = buildCanvasMentionEditorModel(original, references);

describe("mention clipboard serialization", () => {
  it("copies selected canonical tokens rather than invisible thumbnail spacers", () => {
    expect(sliceCanvasMentionEditorSelection(model.displayValue, model.segments, 0, model.displayValue.length).value).toBe(original);
    expect(sliceCanvasMentionEditorSelection(model.displayValue, model.segments, 0, 1).value).toBe("前");
    const first = model.segments[0];
    expect(sliceCanvasMentionEditorSelection(model.displayValue, model.segments, first.start + 1, first.end - 1)).toEqual({
      start: first.start, end: first.end, value: "@[node:a]",
    });
    expect(sliceCanvasMentionEditorSelection(model.displayValue, model.segments, first.start + 1, first.start + 1).value).toBe("");
  });

  it.each(["node:a", "node:b", "asset:library", "node:missing"])("pastes %s without confusing adjacent identical placeholders", key => {
    const first = model.segments[0];
    const next = replaceCanvasMentionEditorSelection(model.displayValue, model.segments, first.start, first.end, `@[${key}]`, references);
    expect(next.value).toBe(`前@[${key}]@[node:b]\n后`);
    expect(next.segments.map(segment => segment.token)).toEqual([`@[${key}]`, "@[node:b]"]);
    expect(next.caret).toBe(next.segments[0].end);
  });

  it("preserves repeated and mixed node/asset references and newlines during a round trip", () => {
    const value = "文字@[node:a]@[node:a]\n@[asset:library]@[node:video]结尾";
    const inserted = replaceCanvasMentionEditorSelection("前后", [], 1, 1, value, references);
    expect(inserted.value).toBe(`前${value}后`);
    expect(sliceCanvasMentionEditorSelection(inserted.displayValue, inserted.segments, 1, inserted.caret).value).toBe(value);
  });

  it("cuts a partial thumbnail as one reference and leaves neighboring references intact", () => {
    const first = model.segments[0];
    const cut = replaceCanvasMentionEditorSelection(model.displayValue, model.segments, first.start + 1, first.end - 1, "", references);
    expect(cut.value).toBe("前@[node:b]\n后");
    expect(cut.caret).toBe(1);
    expect(cut.segments[0].start).toBe(1);
  });
});
