// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ComicRetainedResult } from "./ComicRetainedResult";

it("shows retained output for manual copying without submitting or adopting it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  const root = createRoot(element);
  const close = vi.fn();
  try {
    await act(async () => root.render(<ComicRetainedResult candidate={{ title: "保留候选", content: "original paid output" }} onClose={close} />));
    const input = element.querySelector("textarea")!;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe("original paid output");
    expect(element.querySelectorAll("button")).toHaveLength(1);
    await act(async () => element.querySelector("button")!.click());
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
