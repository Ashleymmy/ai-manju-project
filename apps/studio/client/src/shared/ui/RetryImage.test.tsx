// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RetryImage } from "./RetryImage";
import { apiUrl, setAuthToken } from "@/shared/api/http";

let container: HTMLDivElement;
let root: Root;
const imageResponse = () => ({ ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) }) as Response;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:recovered");
    static revokeObjectURL = vi.fn();
  });
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

it("recovers only the failed native API image for a token-only session and revokes its blob on source change", async () => {
  setAuthToken("preview-token", false);
  vi.mocked(fetch).mockResolvedValue(imageResponse());
  const error = vi.fn();
  const load = vi.fn();
  const source = apiUrl("/api/assets/image/content", { scope: "team", thumbnail: 320 });
  await act(async () => root.render(<><RetryImage src={source} onError={error} onLoad={load} /><RetryImage src="/healthy" /></>));
  expect(fetch).not.toHaveBeenCalled();
  const healthy = container.querySelectorAll("img")[1];
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(fetch).toHaveBeenCalledWith(source, expect.objectContaining({ headers: { Authorization: "Bearer preview-token" } }));
  expect(container.querySelector("img")!.getAttribute("src")).toBe("blob:recovered");
  expect(container.querySelectorAll("img")[1]).toBe(healthy);
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("load")));
  expect(load).toHaveBeenCalledOnce();
  expect(error).not.toHaveBeenCalled();
  // jsdom schedules storage events when the test session token is written.
  await act(async () => vi.advanceTimersByTime(0));
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => root.render(<RetryImage src="/changed" />));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:recovered");
});

it("aborts recovery on unmount and ignores a late response without leaking a blob URL", async () => {
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValue(new Promise(done => { resolve = done; }));
  await act(async () => root.render(<RetryImage src={apiUrl("/api/assets/slow/content")} />));
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
  const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(imageResponse()));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(0));
  expect(vi.getTimerCount()).toBe(0);
});

it("shows a reload action after recovery fails and can recover on a later click", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  const error = vi.fn();
  await act(async () => root.render(<RetryImage src={apiUrl("/api/assets/retry/content")} onError={error} alt="风景" showRetryButton />));
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(error).toHaveBeenCalledOnce();
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("图片加载失败");
  vi.mocked(fetch).mockResolvedValueOnce(imageResponse());
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="重新加载图片"]')!.click());
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(container.querySelector("img")!.getAttribute("src")).toBe("blob:recovered");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("does not put an interactive retry inside a picker button by default", async () => {
  const select = vi.fn();
  vi.mocked(fetch).mockResolvedValue(new Response("unavailable", { status: 503 }));
  await act(async () => root.render(<button onClick={select}><RetryImage src={apiUrl("/api/assets/picker/content")} /></button>));
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(container.querySelectorAll("button")).toHaveLength(1);
  expect(container.textContent).toContain("图片加载失败");
  await act(async () => container.querySelector<HTMLSpanElement>(".retry-image-error")!.click());
  expect(select).toHaveBeenCalledOnce();
});

it("times out a stalled recovery and reports failure once", async () => {
  vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
  const error = vi.fn();
  await act(async () => root.render(<RetryImage src={apiUrl("/api/assets/stalled/content")} onError={error} fallback={<span>Unavailable</span>} />));
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
  await act(async () => vi.runAllTimers());
  expect(vi.mocked(fetch).mock.calls[0][1]!.signal!.aborted).toBe(true);
  expect(error).toHaveBeenCalledOnce();
  expect(container.textContent).toBe("Unavailable");
});
