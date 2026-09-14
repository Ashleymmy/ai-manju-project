// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasPopover, CanvasPopoverContent, CanvasPopoverTrigger } from "./CanvasPopover";

describe("canvas popovers share outside dismissal", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onOpenChange = vi.fn();
  const onOption = vi.fn();
  const onToolbar = vi.fn();
  const button = (label: string) => [...document.querySelectorAll("button")].find(item => item.textContent === label)!;
  const panel = (name = "参数内容") => document.querySelector(`[aria-label="${name}"]`);
  async function click(label: string) {
    await act(async () => {
      button(label).dispatchEvent(new Event("pointerdown", { bubbles: true }));
      button(label).click();
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
  function Controls() {
    return <>
      <input aria-label="节点标题" defaultValue="保留标题" />
      <input aria-label="时长" type="range" min="1" max="10" defaultValue="5" />
      <button onClick={onOption}>设置比例</button>
      <CanvasPopover>
        <CanvasPopoverTrigger asChild><button>更多参数</button></CanvasPopoverTrigger>
        <CanvasPopoverContent aria-label="子菜单"><button onClick={onOption}>子选项</button></CanvasPopoverContent>
      </CanvasPopover>
    </>;
  }
  function Fixture({ controlled = false, active = true }: { controlled?: boolean; active?: boolean }) {
    const [open, setOpen] = useState(false);
    return <div onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <CanvasPopover active={active} open={controlled ? open : undefined} onOpenChange={next => { setOpen(next); onOpenChange(next); }}>
        <CanvasPopoverTrigger asChild><button>参数</button></CanvasPopoverTrigger>
        <CanvasPopoverContent aria-label="参数内容" onPointerDown={event => event.stopPropagation()}><Controls /></CanvasPopoverContent>
      </CanvasPopover>
      <CanvasPopover>
        <CanvasPopoverTrigger asChild><button>图片工具</button></CanvasPopoverTrigger>
        <CanvasPopoverContent aria-label="图片工具内容"><button>裁剪</button></CanvasPopoverContent>
      </CanvasPopover>
      <button onClick={onToolbar}>外部工具栏</button>
      <input aria-label="外部提示词" />
    </div>;
  }
  async function render(controlled = false, active = true) {
    await act(async () => root.render(<Fixture controlled={controlled} active={active} />));
  }
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([false, true])("closes controlled=%s popovers on the first outside press even after interacting inside", async controlled => {
    await render(controlled);
    await click("参数");
    await click("设置比例");
    expect(panel()).not.toBeNull();
    expect(onOption).toHaveBeenCalledOnce();
    await click("外部工具栏");
    expect(panel()).toBeNull();
    expect(onToolbar).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("supports click-only activation outside without consuming the clicked action", async () => {
    await render(); await click("参数");
    await act(async () => button("外部工具栏").click());
    expect(panel()).toBeNull();
    expect(onToolbar).toHaveBeenCalledOnce();
  });

  it("lets inputs and sliders operate inside, keeping outside input focus when closing", async () => {
    await render(); await click("参数");
    const input = panel()!.querySelector<HTMLInputElement>('[aria-label="节点标题"]')!;
    const slider = panel()!.querySelector('[type="range"]')!;
    await act(async () => {
      input.dispatchEvent(new Event("pointerdown", { bubbles: true })); input.focus();
      slider.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      document.body.dispatchEvent(new Event("pointermove", { bubbles: true }));
      document.body.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    expect(panel()).not.toBeNull();
    expect(input.value).toBe("保留标题");
    const outside = container.querySelector<HTMLInputElement>('[aria-label="外部提示词"]')!;
    await act(async () => {
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true })); outside.focus();
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it("switches directly to another popover without reopening the previous one", async () => {
    await render(); await click("参数"); await click("图片工具");
    expect(panel()).toBeNull();
    expect(panel("图片工具内容")).not.toBeNull();
  });

  it("recognizes a nested portal as inside its parent", async () => {
    await render(); await click("参数"); await click("更多参数");
    expect(panel()).not.toBeNull();
    expect(panel("子菜单")).not.toBeNull();
    await click("子选项");
    expect(onOption).toHaveBeenCalledOnce();
    expect(panel()).not.toBeNull();
    await click("设置比例");
    expect(panel("子菜单")).toBeNull();
    expect(panel()).not.toBeNull();
    await click("外部工具栏");
    expect(panel()).toBeNull();
  });

  it("cleans up on hide and still supports Escape and the trigger toggle", async () => {
    await render(); await click("参数"); await render(false, false);
    expect(panel()).toBeNull();
    await render(); expect(panel()).toBeNull();
    await click("参数"); await click("参数"); expect(panel()).toBeNull();
    await click("参数");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(panel()).toBeNull();
  });
});
