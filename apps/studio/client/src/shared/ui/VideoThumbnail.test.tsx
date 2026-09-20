// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VideoThumbnail, videoPosterUrl } from "./VideoThumbnail";
import { getAssetMediaUrl } from "@/entities/asset";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("loads a lazy authenticated poster without downloading an original video", async () => {
  await act(async () => root.render(<VideoThumbnail src={getAssetMediaUrl("asset_video", "team")} />));
  const img = container.querySelector("img")!;
  expect(img.getAttribute("loading")).toBe("lazy");
  expect(img.getAttribute("src")).toContain("scope=team&poster=1");
  expect(container.querySelector("video")).toBeNull();
  await act(async () => img.dispatchEvent(new Event("error")));
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("video")).toBeNull();
});
it("never treats external or legacy blob URLs as authenticated posters", () => {
  expect(videoPosterUrl("https://untrusted.example/api/assets/asset/content")).toBeUndefined();
  expect(videoPosterUrl("blob:video")).toBeUndefined();
});
