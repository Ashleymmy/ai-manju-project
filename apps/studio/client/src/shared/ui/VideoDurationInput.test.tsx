// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { VideoDurationInput } from "./VideoDurationInput";

afterEach(() => vi.unstubAllGlobals());

it("supports every whole second up to 30 and keeps automatic duration separate", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  function Example() {
    const [value, setValue] = useState("23");
    return <VideoDurationInput value={value} durations={[-1, 4, 5, 10, 20, 30]} continuous
      onChange={seconds => { onChange(seconds); setValue(seconds); }} />;
  }
  try {
    await act(async () => root.render(<Example />));
    const range = container.querySelector("input")!;
    expect([range.min, range.max, range.step, range.value]).toEqual(["4", "30", "1", "23"]);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    for (const value of ["7", "23", "30"]) {
      await act(async () => {
        setValue.call(range, value);
        range.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(onChange).toHaveBeenLastCalledWith(value);
    }
    await act(async () => container.querySelector("button")!.click());
    expect(onChange).toHaveBeenLastCalledWith("-1");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
