// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RetryImage } from "./RetryImage";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("retries only the failed image twice without modifying a signed URL, then shows fallback", async () => {
  const error = vi.fn();
  const ref = createRef<HTMLImageElement>();
  const src = "https://media.example/image?signature=test";
  await act(async () => root.render(<><RetryImage src={src} ref={ref} onError={error} fallback={<span>Unavailable</span>} /><RetryImage src="/healthy" /></>));
  const healthy = container.querySelectorAll("img")[1];
  for (const delay of [1000, 2000]) {
    const failed = container.querySelector("img")!;
    expect(ref.current).toBe(failed);
    await act(async () => failed.dispatchEvent(new Event("error")));
    expect(error).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(delay));
    expect(container.querySelector("img")).not.toBe(failed);
    expect(container.querySelector("img")!.getAttribute("src")).toBe(src);
    expect(container.querySelectorAll("img")[1]).toBe(healthy);
  }
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(error).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe("Unavailable");
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels retries when the source changes or the page unmounts", async () => {
  await act(async () => root.render(<RetryImage src="/personal" />));
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => root.render(<RetryImage src="/team" />));
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
  await act(async () => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});

it("retains load callbacks and does not retry invalid local object URLs", async () => {
  const load = vi.fn();
  const error = vi.fn();
  await act(async () => root.render(<RetryImage src="blob:local" onLoad={load} onError={error} />));
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("load")));
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(error).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
