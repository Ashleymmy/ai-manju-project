// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { VideoDurationInput } from "./VideoDurationInput";

afterEach(() => vi.unstubAllGlobals());

it.each([30, 15])("anchors the midpoint to half of %i and snaps to supported seconds", async max => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  const durations = [-1, ...Array.from({ length: max - 3 }, (_, i) => i + 4)];
  function Example() {
    const [value, setValue] = useState("5");
    return <VideoDurationInput value={value} durations={durations}
      onChange={seconds => { onChange(seconds); setValue(seconds); }} />;
  }
  try {
    await act(async () => root.render(<Example />));
    const range = container.querySelector("input")!;
    expect(range.getAttribute("aria-valuemax")).toBe(String(max));
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    for (const [position, expected] of [[50, Math.round(max / 2)], [100, max], [0, 4]]) {
      await act(async () => {
        setValue.call(range, String(position));
        range.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(onChange).toHaveBeenLastCalledWith(String(expected));
      expect(container.querySelector(".video-duration-input-caption > :nth-child(2)")?.textContent).toBe(`${max / 2}s`);
    }
    await act(async () => range.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(onChange).toHaveBeenLastCalledWith("5");
    await act(async () => container.querySelector("button")!.click());
    expect(onChange).toHaveBeenLastCalledWith("-1");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("offers only live discrete choices and replaces them when capabilities are unknown", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const onChange = vi.fn();
  try {
    await act(async () => root.render(<VideoDurationInput value="5" durations={[5, 10]} onChange={onChange} />));
    expect(container.querySelector("input[type=range]")).toBeNull();
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map(button => button.textContent)).toEqual(["5 秒", "10 秒"]);
    await act(async () => buttons[1].click());
    expect(onChange).toHaveBeenLastCalledWith("10");
    await act(async () => root.render(<VideoDurationInput value="10" durations={[]} onChange={onChange} />));
    expect(container.querySelector("input[type=range]")).toBeNull();
    expect(container.textContent).toContain("未提供时长范围");
    expect(container.querySelector("input")?.hasAttribute("max")).toBe(false);
  } finally { await act(async () => root.unmount()); }
});
