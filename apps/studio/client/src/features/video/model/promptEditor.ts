// A compact, nonbreaking footprint shared by the native input and its visual mirror.
export const PROMPT_REFERENCE_DISPLAY = "\u2007".repeat(14);
// Long labels have a bounded footprint and remain on their own row.
export const PROMPT_LONG_REFERENCE_MAX_FIGURES = 56;
const REFERENCE_DECORATION_FIGURES = 4;
const REFERENCE_PATTERN = /@\[ref:([^\]]+)\]/g;
type PromptReferenceLayout = ReadonlyMap<string, { display: string; long: boolean }>;
const DEFAULT_LAYOUT: PromptReferenceLayout = new Map();

export function buildPromptReferenceLayout(references: readonly { id: string; token?: string; name: string }[], capacity = PROMPT_LONG_REFERENCE_MAX_FIGURES): PromptReferenceLayout {
  return new Map(references.map(reference => {
    const label = reference.token || reference.name;
    const figures = Array.from(label).reduce((width, character) => width + (/^[\x00-\x7f]$/.test(character) ? 1 : 2), REFERENCE_DECORATION_FIGURES);
    const long = figures > PROMPT_REFERENCE_DISPLAY.length;
    return [reference.id, { long, display: long
      ? "\u2007".repeat(Math.max(1, Math.min(figures, capacity, PROMPT_LONG_REFERENCE_MAX_FIGURES)))
      : PROMPT_REFERENCE_DISPLAY }];
  }));
}

export function separatePromptReferences(value: string, caret = value.length, layout: PromptReferenceLayout = DEFAULT_LAYOUT, preserveLineBreaks = false) {
  const replace = (start: number, end: number, text: string) => {
    if (caret >= end) caret += text.length - (end - start);
    else if (caret > start) caret = start + text.length;
    value = value.slice(0, start) + text + value.slice(end);
  };
  // Remove old inline separators without changing the surrounding prompt text.
  for (const match of [...value.matchAll(/[ \t]*(@\[ref:[^\]]+\])[ \t]*/g)].reverse()) {
    replace(match.index!, match.index! + match[0].length, match[1]);
  }
  const tokens = [...value.matchAll(REFERENCE_PATTERN)];
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (let index = 0; index < tokens.length; index++) {
    const match = tokens[index], previous = tokens[index - 1], next = tokens[index + 1];
    const start = match.index!, end = start + match[0].length;
    const gap = previous ? value.slice(previous.index! + previous[0].length, start) : "";
    const joined = Boolean(previous) && /^[ \t\r\n]*$/.test(gap) && !/\n[ \t\r]*\n/.test(gap)
      && !(preserveLineBreaks && gap.includes("\n"));
    const long = layout.get(match[1])?.long ?? false;
    if (joined) {
      const newRow = long || layout.get(previous[1])?.long;
      edits.push({ start: previous.index! + previous[0].length, end: start, text: newRow ? "\n" : " " });
    } else {
      if (start && value[start - 1] !== "\n") edits.push({ start, end: start, text: "\n" });
    }
    const following = next ? value.slice(end, next.index) : "";
    if ((!next || !/^[ \t\r\n]*$/.test(following)) && value[end] !== "\n") {
      edits.push({ start: end, end, text: "\n" });
    }
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) replace(edit.start, edit.end, edit.text);
  return { value, caret };
}

export function buildPromptEditor(value: string, layout: PromptReferenceLayout = DEFAULT_LAYOUT) {
  const segments: Array<{ id: string; start: number; end: number; rawStart: number; rawEnd: number }> = [];
  let display = "", cursor = 0;
  for (const match of value.matchAll(REFERENCE_PATTERN)) {
    display += value.slice(cursor, match.index);
    const start = display.length;
    display += layout.get(match[1])?.display ?? PROMPT_REFERENCE_DISPLAY;
    cursor = match.index! + match[0].length;
    segments.push({ id: match[1], start, end: display.length, rawStart: match.index!, rawEnd: cursor });
  }
  display += value.slice(cursor);
  return { value, display, segments, layout };
}

export type PromptEditorModel = ReturnType<typeof buildPromptEditor>;

export function promptRawOffset(model: PromptEditorModel, offset: number, edge: "nearest" | "start" | "end" = "nearest") {
  let delta = 0;
  for (const segment of model.segments) {
    if (offset <= segment.start) break;
    if (offset < segment.end) {
      return edge === "start" || (edge === "nearest" && offset - segment.start <= segment.end - offset)
        ? segment.rawStart : segment.rawEnd;
    }
    delta += (segment.rawEnd - segment.rawStart) - (segment.end - segment.start);
  }
  return offset + delta;
}

export function promptDisplayOffset(model: PromptEditorModel, offset: number) {
  let delta = 0;
  for (const segment of model.segments) {
    if (offset <= segment.rawStart) break;
    if (offset < segment.rawEnd) return segment.start;
    delta += (segment.end - segment.start) - (segment.rawEnd - segment.rawStart);
  }
  return offset + delta;
}

export function promptRawSelection(model: PromptEditorModel, start: number, end: number) {
  return {
    start: promptRawOffset(model, start, start === end ? "nearest" : "start"),
    end: promptRawOffset(model, end, start === end ? "nearest" : "end"),
  };
}

export function replacePromptSelection(model: PromptEditorModel, start: number, end: number, text: string) {
  const range = promptRawSelection(model, start, end);
  return separatePromptReferences(model.value.slice(0, range.start) + text + model.value.slice(range.end), range.start + text.length, model.layout, true);
}

export function applyPromptInput(model: PromptEditorModel, display: string, caret: number) {
  // Anchor the diff at the native caret: repeated references have identical display spacers.
  let start = 0;
  while (start < caret && start < model.display.length && model.display[start] === display[start]) start++;
  let oldEnd = model.display.length, newEnd = display.length;
  while (oldEnd > start && newEnd > caret && model.display[oldEnd - 1] === display[newEnd - 1]) {
    oldEnd--; newEnd--;
  }
  return replacePromptSelection(model, start, oldEnd, display.slice(start, newEnd));
}
