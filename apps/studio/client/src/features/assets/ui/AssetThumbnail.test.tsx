// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetThumbnail } from "./AssetThumbnail";

const load = vi.hoisted(() => vi.fn());
vi.mock("@/entities/asset", () => ({ getAssetContentObjectUrl: load }));
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

it("displays a ready thumbnail while another is pending and reuses it after rename", async () => {
  let finishSlow!: (url: string) => void;
  load.mockImplementation((id: string) => id === "slow" ? new Promise<string>(resolve => { finishSlow = resolve; }) : Promise.resolve("blob:fast"));
  const render = (name: string) => <><AssetThumbnail id="slow" scope="personal" name="slow" /><AssetThumbnail id="fast" scope="personal" name={name} /></>;
  await act(async () => root.render(render("fast")));
  expect(container.querySelectorAll("img")[1].getAttribute("src")).toBe("blob:fast");
  await act(async () => root.render(render("renamed")));
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => finishSlow("blob:slow"));
  expect(container.querySelectorAll("img")[0].getAttribute("src")).toBe("blob:slow");
});

it("aborts the old scope request and releases a late thumbnail", async () => {
  let finish!: (url: string) => void;
  load.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; })).mockResolvedValue("blob:team");
  await act(async () => root.render(<AssetThumbnail id="image" scope="personal" name="image" />));
  const signal = load.mock.calls[0][3] as AbortSignal;
  await act(async () => root.render(<AssetThumbnail id="image" scope="team" name="image" />));
  expect(signal.aborted).toBe(true);
  await act(async () => finish("blob:old"));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:old");
  expect(container.querySelector("img")!.getAttribute("src")).toBe("blob:team");
});
