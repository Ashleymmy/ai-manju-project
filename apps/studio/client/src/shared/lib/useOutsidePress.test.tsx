// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useOutsidePress } from "./useOutsidePress";

it("keeps the connection menu open through the release that creates it, then dismisses on the next outside press", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onDismiss = vi.fn();
  function ConnectionMenu() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useOutsidePress(open, event => event.composedPath().includes(ref.current!), () => { onDismiss(); setOpen(false); }, false);
    return <div onPointerDown={event => event.stopPropagation()}>
      <button onPointerUp={() => setOpen(true)}>连线释放点</button>
      {open && <div ref={ref} data-menu><button>新建图片</button></div>}
    </div>;
  }
  try {
    await act(async () => root.render(<ConnectionMenu />));
    const trigger = container.querySelector("button")!;
    await act(async () => trigger.dispatchEvent(new Event("pointerup", { bubbles: true })));
    await act(async () => trigger.click());
    expect(container.querySelector("[data-menu]")).not.toBeNull();
    await act(async () => container.querySelector("[data-menu] button")!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(container.querySelector("[data-menu]")).not.toBeNull();
    await act(async () => trigger.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(container.querySelector("[data-menu]")).toBeNull();
    expect(onDismiss).toHaveBeenCalledOnce();
    await act(async () => trigger.dispatchEvent(new Event("pointerup", { bubbles: true })));
    await act(async () => root.unmount());
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
