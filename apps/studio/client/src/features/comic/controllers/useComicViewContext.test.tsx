// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComicViewContext } from "./useComicViewContext";

const auth = vi.hoisted(() => ({ token: "account-one" }));
vi.mock("@/shared/api/http", () => ({ getAuthToken: () => auth.token }));

describe("comic asynchronous view ownership", () => {
  let context: ReturnType<typeof useComicViewContext>;
  let container: HTMLDivElement;
  let root: Root;
  function View() { context = useComicViewContext(); return null; }
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    auth.token = "account-one";
    container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root.render(<View />));
  });
  afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

  it("rejects callbacks from a previous workspace even after returning to that workspace", () => {
    const old = context.captureView();
    context.invalidateView();
    const secondSpace = context.captureView();
    context.invalidateView();
    expect(old()).toBe(false);
    expect(secondSpace()).toBe(false);
    expect(context.captureView()()).toBe(true);
  });

  it("accepts a new account's callbacks while rejecting the previous account's callbacks", () => {
    const old = context.captureView();
    auth.token = "account-two";
    expect(old()).toBe(false);
    expect(context.captureView()()).toBe(true);
  });

  it("ignores obsolete reads without invalidating other operation channels", () => {
    const firstRead = context.captureView("batch");
    const otherRead = context.captureView("project");
    const mutation = context.captureView();
    const latestRead = context.captureView("batch");
    expect(firstRead()).toBe(false);
    expect(otherRead()).toBe(true);
    expect(mutation()).toBe(true);
    expect(latestRead()).toBe(true);
  });

  it("ignores callbacks after leaving the page", async () => {
    const pending = context.captureView();
    await act(async () => root.render(null));
    expect(pending()).toBe(false);
  });
});
