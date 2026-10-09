// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CropDialog } from "./ImageEditDialogs";

vi.mock("@/features/member", () => ({ GenerationPrice: () => null }));
/** Rendered size of the crop stage in the test, in px. */
const STAGE = 600;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const cropBox = () => document.querySelector<HTMLElement>(".crop-dialog-box")!;
const boxAspect = () => parseFloat(cropBox().style.width) / parseFloat(cropBox().style.height);
async function click(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find(item => item.textContent === label);
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}
async function drag(target: Element, dx: number, dy: number) {
  const pointer = (type: string, x: number, y: number) => new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  await act(async () => { target.dispatchEvent(pointer("pointerdown", 400, 400)); });
  await act(async () => { document.dispatchEvent(pointer("pointermove", 400 + dx, 400 + dy)); });
  await act(async () => { document.dispatchEvent(pointer("pointerup", 400 + dx, 400 + dy)); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("keeps the chosen preset ratio while a corner is dragged", async () => {
  await act(async () => root.render(<CropDialog open imageUrl="blob:test" busy={false} onClose={vi.fn()} onRun={vi.fn()} />));
  const stage = document.querySelector<HTMLElement>(".crop-dialog-frame")!;
  stage.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: STAGE, bottom: STAGE, width: STAGE, height: STAGE, toJSON: () => ({}) });

  await click("16:9");
  expect(boxAspect()).toBeCloseTo(16 / 9, 5);
  await drag(cropBox().querySelector('[aria-label="从 se 方向调整裁剪框"]')!, -90, 40);
  expect(parseFloat(cropBox().style.width)).toBeLessThan(92);
  expect(boxAspect()).toBeCloseTo(16 / 9, 5);

  await click("自由");
  await drag(cropBox().querySelector('[aria-label="从 se 方向调整裁剪框"]')!, 0, 60);
  expect(boxAspect()).not.toBeCloseTo(16 / 9, 2);
});
