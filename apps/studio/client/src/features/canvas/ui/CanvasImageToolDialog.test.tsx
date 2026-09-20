// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CanvasImageToolDialog } from "./CanvasDialogs";
import { CANVAS_CROP_RATIOS, defaultCanvasImageToolDraft, type CanvasImageToolDraft } from "../domain/imageTool";
import { imageCropRectFromDraft } from "../domain/imageData";

let root: Root;
let container: HTMLDivElement;
let current: CanvasImageToolDraft;
const run = vi.fn();
function Harness({ busy = false }: { busy?: boolean }) {
  const [draft, setDraft] = useState(defaultCanvasImageToolDraft);
  const cropStageRef = useRef<HTMLDivElement>(null);
  current = draft;
  return <CanvasImageToolDialog dialog={{ nodeId: "image", mode: "crop" }} busy={busy} error="" preview="blob:preview"
    node={{ id: "image", kind: "image", title: "Source", content: "", x: 0, y: 0, width: 320, height: 180 }}
    crop={imageCropRectFromDraft(draft)} cropStageRef={cropStageRef} draft={draft}
    onOpenChange={vi.fn()} onStartCropPointer={vi.fn()} onSelectMode={vi.fn()} onDraftChange={setDraft}
    onCancel={vi.fn()} onRun={() => run(draft)} />;
}
const ratioButton = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>(".canvas-image-crop-ratios button")).find(button => button.textContent === label)!;
async function loadImage() {
  const image = document.querySelector<HTMLImageElement>(".canvas-image-crop-stage img")!;
  Object.defineProperties(image, { naturalWidth: { value: 1600 }, naturalHeight: { value: 900 } });
  await act(async () => image.dispatchEvent(new Event("load")));
}
async function setSize(index: number, value: string) {
  const input = document.querySelectorAll<HTMLInputElement>('.canvas-image-tool-fields input[type="number"]')[index];
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  run.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("replaces position inputs with common ratios and keeps the hidden accessible dialog title", async () => {
  expect(document.querySelector("[role=dialog]")?.textContent).not.toContain("左侧起点");
  expect(document.querySelector("[role=dialog]")?.textContent).not.toContain("顶部起点");
  expect(document.querySelector("h2")?.closest(".sr-only")).not.toBeNull();
  expect(document.querySelectorAll(".canvas-image-crop-ratios button")).toHaveLength(8);
  expect(ratioButton("16:9").disabled).toBe(true);
  await loadImage();
  expect(ratioButton("16:9").disabled).toBe(false);
});

it.each(CANVAS_CROP_RATIOS.filter(preset => preset.ratio !== null))("applies $label to real source dimensions and passes the same crop to execution", async ({ label, ratio }) => {
  await loadImage();
  await act(async () => ratioButton(label).click());
  expect(ratioButton(label).getAttribute("aria-pressed")).toBe("true");
  const rect = imageCropRectFromDraft(current);
  expect(rect.width * 1600 / (rect.height * 900)).toBeCloseTo(ratio!, 3);
  expect(rect.x).toBeCloseTo((1 - rect.width) / 2, 3);
  expect(rect.y).toBeCloseTo((1 - rect.height) / 2, 3);
  const execute = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("执行裁剪"))!;
  await act(async () => execute.click());
  expect(run).toHaveBeenCalledWith(current);
});

it("keeps numeric edits and reset constrained, then permits free resizing", async () => {
  await loadImage();
  await act(async () => ratioButton("3:4").click());
  await setSize(0, "25");
  expect(current.cropWidth).toBe(25);
  expect(current.cropWidth * 1600 / (current.cropHeight * 900)).toBeCloseTo(3 / 4, 3);
  await setSize(1, "40");
  expect(current.cropHeight).toBe(40);
  expect(current.cropWidth * 1600 / (current.cropHeight * 900)).toBeCloseTo(3 / 4, 3);
  await act(async () => document.querySelector<HTMLButtonElement>(".canvas-image-crop-actions button")!.click());
  expect(ratioButton("3:4").getAttribute("aria-pressed")).toBe("true");
  expect(current.cropHeight).toBe(92);
  await act(async () => ratioButton("自由").click());
  const height = current.cropHeight;
  await setSize(0, "20");
  expect(current.cropHeight).toBe(height);
  expect(current.cropRatio).toBeNull();
});

it("disables crop settings and handles during processing", async () => {
  await loadImage();
  await act(async () => root.render(<Harness busy />));
  const controls = Array.from(document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(".canvas-image-crop-ratios button, .canvas-image-tool-fields input, .canvas-image-crop-handle, .canvas-image-crop-actions button"));
  expect(controls.length).toBeGreaterThan(0);
  expect(controls.every(control => control.disabled)).toBe(true);
});
