// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useVideoPreflight, type VideoPreflightCheck } from "./useVideoPreflight";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("blocks until checked, ignores stale results and permits retry without generating", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers();
  const host = document.createElement("div"); const root = createRoot(host);
  const work: Array<{ signal: AbortSignal; resolve: (value: string[]) => void; reject: (error: Error) => void }> = [];
  const check: VideoPreflightCheck = vi.fn((_id, signal) => new Promise<string[]>((resolve, reject) => work.push({ signal, resolve, reject })));
  function Harness({ version, active = true }: { version: string; active?: boolean }) {
    const state = useVideoPreflight(active ? "video" : "", version, check);
    return <><button disabled={state.blocked}>生成</button><p>{state.message}</p><button onClick={state.retry}>检查</button></>;
  }
  const render = async (version: string, active = true) => { await act(async () => root.render(<Harness version={version} active={active} />)); };
  try {
    await render("short-model");
    expect(host.querySelector("button")!.disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await render("long-model");
    expect(work[0].signal.aborted).toBe(true);
    await act(async () => { work[0].resolve([]); await vi.advanceTimersByTimeAsync(200); });
    expect(host.querySelector("button")!.disabled).toBe(true);
    await act(async () => work[1].reject(new Error("音频读取失败")));
    expect(host.textContent).toContain("音频读取失败");
    expect(host.querySelector("button")!.disabled).toBe(true);
    await act(async () => host.querySelectorAll("button")[1].click());
    await act(async () => { await vi.advanceTimersByTimeAsync(200); work[2].resolve(["音频：20 秒"]); });
    expect(host.querySelector("button")!.disabled).toBe(false);
    await render("long-model", false);
    await render("long-model");
    expect(host.querySelector("button")!.disabled).toBe(true);
    await render("another-reference");
    expect(host.querySelector("button")!.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); }
});

it("releases a slow passive check after three seconds and ignores its late result", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers();
  const host = document.createElement("div"); const root = createRoot(host);
  let signal!: AbortSignal;
  let resolve!: (value: string[]) => void;
  const check: VideoPreflightCheck = (_id, currentSignal) => {
    signal = currentSignal;
    return new Promise(done => { resolve = done; });
  };
  function Harness() {
    const state = useVideoPreflight("video", "same", check);
    return <><button disabled={state.blocked}>生成</button><p>{state.message}</p></>;
  }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(signal.aborted).toBe(true);
    expect(host.querySelector("button")!.disabled).toBe(false);
    expect(host.textContent).toContain("提交前将校验参考素材");
    await act(async () => resolve(["late"]));
    expect(host.textContent).toContain("提交前将校验参考素材");
  } finally { await act(async () => root.unmount()); }
});
