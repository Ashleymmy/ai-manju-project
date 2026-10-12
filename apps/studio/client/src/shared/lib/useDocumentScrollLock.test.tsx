// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDocumentScrollLock } from "./useDocumentScrollLock";

function Probe({ active }: { active: boolean }) {
  useDocumentScrollLock(active);
  return null;
}

describe("useDocumentScrollLock", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    document.documentElement.style.overflow = "auto";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.documentElement.removeAttribute("style");
    vi.unstubAllGlobals();
  });

  it("locks the page only while active and restores the previous style", async () => {
    await act(async () => root.render(<Probe active={false} />));
    expect(document.documentElement.style.overflow).toBe("auto");
    await act(async () => root.render(<Probe active />));
    expect(document.documentElement.style.overflow).toBe("hidden");
    await act(async () => root.render(<Probe active={false} />));
    expect(document.documentElement.style.overflow).toBe("auto");
  });

  it("releases the lock when the owner unmounts", async () => {
    await act(async () => root.render(<Probe active />));
    await act(async () => root.unmount());
    root = createRoot(container);
    expect(document.documentElement.style.overflow).toBe("auto");
  });
});
