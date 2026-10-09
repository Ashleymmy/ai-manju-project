// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWheelScrollChaining } from "./useWheelScrollChaining";

function setScrollBox(element: HTMLElement, scrollHeight: number, clientHeight: number, scrollTop: number) {
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: clientHeight });
  element.scrollTop = scrollTop;
}

function Harness() {
  const [list, setList] = useState<HTMLElement | null>(null);
  useWheelScrollChaining(list);
  return <div data-testid="page" style={{ overflowY: "auto" }}><div data-testid="list" ref={setList} /></div>;
}

function wheel(element: HTMLElement, deltaY: number) {
  const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

let root: Root | null = null;
let host: HTMLElement | null = null;

async function setupAsync(listTop: number, pageTop: number) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<Harness />));
  const page = host.querySelector<HTMLElement>('[data-testid="page"]')!;
  const list = host.querySelector<HTMLElement>('[data-testid="list"]')!;
  setScrollBox(page, 2000, 800, pageTop);
  setScrollBox(list, 1000, 400, listTop);
  return { page, list };
}

describe("useWheelScrollChaining", () => {
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  it("scrolls the list itself while it still has room", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { page, list } = await setupAsync(300, 400);
    expect(wheel(list, -100).defaultPrevented).toBe(true);
    expect(list.scrollTop).toBe(200);
    expect(page.scrollTop).toBe(400);
  });

  it("leaves zooming, sideways and impossible scrolls to the browser", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { list } = await setupAsync(0, 0);
    expect(wheel(list, -100).defaultPrevented).toBe(false);
    const zoom = new WheelEvent("wheel", { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true });
    list.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(false);
    const sideways = new WheelEvent("wheel", { deltaX: 100, deltaY: 10, bubbles: true, cancelable: true });
    list.dispatchEvent(sideways);
    expect(sideways.defaultPrevented).toBe(false);
  });

  it("hands the rest of a wheel step to the page in the same gesture", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { page, list } = await setupAsync(30, 400);
    const event = wheel(list, -100);
    expect(event.defaultPrevented).toBe(true);
    expect(list.scrollTop).toBe(0);
    expect(page.scrollTop).toBe(330);

    expect(wheel(list, -500).defaultPrevented).toBe(true);
    expect(page.scrollTop).toBe(0);
    // With the page at its top too there is nothing left to hand over.
    expect(wheel(list, -100).defaultPrevented).toBe(false);
  });

  it("continues downward once the list reaches its bottom", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { page, list } = await setupAsync(600, 0);
    expect(wheel(list, 120).defaultPrevented).toBe(true);
    expect(list.scrollTop).toBe(600);
    expect(page.scrollTop).toBe(120);
  });

  it("eases the page toward the accumulated target across wheel steps", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const { page, list } = await setupAsync(50, 400);
    wheel(list, -100);
    wheel(list, -100);
    // One animation per scroller: the list runs out after 50px, the page takes the other 150px.
    expect(frames).toHaveLength(2);
    for (let index = 0; index < 100 && frames.length; index += 1) frames.shift()!(0);
    expect(list.scrollTop).toBe(0);
    expect(page.scrollTop).toBe(250);
  });

  it("keeps the page animation going when the pointer ends up outside the list", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const { page, list } = await setupAsync(0, 400);
    wheel(list, -100);
    const header = page.insertBefore(document.createElement("div"), list);
    expect(wheel(header, -100).defaultPrevented).toBe(true);
    for (let index = 0; index < 100 && frames.length; index += 1) frames.shift()!(0);
    expect(page.scrollTop).toBe(200);
    // Once the page has settled, wheel steps outside the list are native again.
    expect(wheel(header, -100).defaultPrevented).toBe(false);
  });
});
