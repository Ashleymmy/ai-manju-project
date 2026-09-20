// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetThumbnail } from "./AssetThumbnail";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  URL.revokeObjectURL = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("assigns native lazy thumbnails independently and preserves them after rename", async () => {
  const render = (name: string) => <><AssetThumbnail id="slow" scope="personal" name="slow" /><AssetThumbnail id="fast" scope="personal" name={name} /></>;
  await act(async () => root.render(render("fast")));
  const images = container.querySelectorAll("img");
  expect(new URL(images[0].src).searchParams.get("thumbnail")).toBe("320");
  expect(new URL(images[1].src).pathname).toBe("/api/assets/fast/content");
  expect(images[1].getAttribute("loading")).toBe("lazy");
  await act(async () => root.render(render("renamed")));
  expect(container.querySelectorAll("img")[1]).toBe(images[1]);
});

it("replaces the old scope URL immediately", async () => {
  await act(async () => root.render(<AssetThumbnail id="image" scope="personal" name="image" />));
  const old = container.querySelector("img");
  await act(async () => root.render(<AssetThumbnail id="image" scope="team" name="image" />));
  expect(container.querySelector("img")).not.toBe(old);
  expect(new URL(container.querySelector("img")!.src).searchParams.get("scope")).toBe("team");
});
