// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Box } from "lucide-react";
import { LineNav } from "./StudioLayout";

const groups = [
  { id: "creation", title: "制作桌", items: [{ href: "/director", label: "3D 导演台", icon: Box }] },
  { id: "library", title: "素材与语言", items: [
    { href: "/image", label: "关键帧生成", icon: Box },
    { href: "/assets", label: "资产库", icon: Box },
  ] },
];

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let frames: Map<number, FrameRequestCallback>;
let sequence: number;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  frames = new Map();
  sequence = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function runFrame(time: number) {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(time));
}

it("keeps one animation during fast pointer movement and clears it across routes and scroll", async () => {
  await act(async () => root.render(<LineNav groups={groups} currentPath="/director" />));
  const rows = [...container.querySelectorAll<HTMLElement>(".ln-row")];
  rows.forEach((row, index) => vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
    top: 100 + index * 40, height: 38, bottom: 138 + index * 40,
    left: 0, right: 264, width: 264, x: 0, y: 100 + index * 40, toJSON: () => ({}),
  }));
  const list = container.querySelector("ul")!;
  await act(async () => {
    for (let count = 0; count < 50; count++) {
      list.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY: 239 }));
    }
  });
  expect(frames.size).toBe(1);
  expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  runFrame(90);
  for (let time = 106; time < 600; time += 16) runFrame(time);
  rows.forEach(row => {
    const value = Number(row.style.getPropertyValue("--effect"));
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });
  expect(Number(rows[3].style.getPropertyValue("--effect"))).toBeGreaterThan(0.9);

  await act(async () => root.render(<LineNav groups={groups} currentPath="/assets" />));
  expect(frames.size).toBe(0);
  expect(container.querySelector('[aria-current="page"]')?.textContent).toContain("资产库");
  rows.forEach(row => expect(row.style.getPropertyValue("--effect")).toBe(row.dataset.active === "1" ? "1" : "0"));
  await act(async () => list.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY: 259 })));
  expect(frames.size).toBe(1);
  await act(async () => list.dispatchEvent(new Event("scroll")));
  expect(frames.size).toBe(0);
  expect(container.querySelectorAll("a")).toHaveLength(3);
  expect(container.textContent).toContain("关键帧生成");
});

it("restores a collapsed destination group on navigation and cancels animation on unmount", async () => {
  localStorage.setItem("ai-manju:rail-open-groups", '["creation"]');
  await act(async () => root.render(<LineNav groups={groups} currentPath="/director" />));
  expect(container.querySelectorAll(".ln-parent")[1].getAttribute("aria-expanded")).toBe("false");
  await act(async () => root.render(<LineNav groups={groups} currentPath="/image" />));
  expect(container.querySelectorAll(".ln-parent")[1].getAttribute("aria-expanded")).toBe("true");
  await act(async () => container.querySelector("ul")!.dispatchEvent(new MouseEvent("pointermove", { bubbles: true })));
  expect(frames.size).toBe(1);
  await act(async () => root.render(null));
  expect(frames.size).toBe(0);
});

it("keeps query-based canvas navigation active and expands its group", async () => {
  localStorage.setItem("ai-manju:rail-open-groups", '[]');
  const canvasGroups = [{ id: "creation", title: "制作桌", items: [{ href: "/canvas?resume=recent", label: "当前任务", icon: Box }] }];
  await act(async () => root.render(<LineNav groups={canvasGroups} currentPath="/canvas" />));
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/canvas?resume=recent");
  expect(container.querySelector("a")?.getAttribute("title")).toBe("当前任务");
  expect(container.querySelector("a .ln-label")?.textContent).toBe("当前任务");
  expect(container.querySelector("a")?.getAttribute("aria-current")).toBe("page");
  expect(container.querySelector(".ln-parent")?.getAttribute("aria-expanded")).toBe("true");
});
