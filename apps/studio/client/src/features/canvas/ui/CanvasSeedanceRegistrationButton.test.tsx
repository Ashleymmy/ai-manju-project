// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasNodeData } from "../domain/types";
import { CanvasSeedanceRegistrationButton } from "./CanvasSeedanceRegistrationButton";

const node: CanvasNodeData = { id: "image", kind: "image", title: "角色", content: "", x: 0, y: 0, width: 200, height: 200 };
describe("registration button feedback", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it.each(["uploading", "queued"] as const)("animates and blocks repeat clicks while a registration is %s", async phase => {
    const onRegister = vi.fn(async () => undefined);
    await act(async () => root.render(<CanvasSeedanceRegistrationButton node={node} onRegister={onRegister} />));
    await act(async () => container.querySelector("button")!.click());
    expect(onRegister).toHaveBeenCalledWith(node);
    await act(async () => root.render(<CanvasSeedanceRegistrationButton node={node} onRegister={onRegister} state={{ phase }} />));
    const button = container.querySelector("button")!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector(".spin")).not.toBeNull();
    button.click();
    expect(onRegister).toHaveBeenCalledTimes(1);
  });

  it("restores success appearance and the new tooltip from saved node metadata", async () => {
    const registered = { ...node, metadata: { seedanceVolcanoAssets: [{ id: "asset", volcanoAssetId: "volcano", status: "Active" }] } };
    await act(async () => root.render(<CanvasSeedanceRegistrationButton node={registered} onRegister={vi.fn()} />));
    const button = container.querySelector("button")!;
    expect(button.classList.contains("is-success")).toBe(true);
    expect(button.querySelector("svg.lucide-badge-check")).not.toBeNull();
    expect(button.querySelector("svg.lucide-check")).toBeNull();
    expect(button.title).toBe("已注册至资产库 · 真人素材，可用于视频参考");
    expect(button.disabled).toBe(true);
  });

  it.each(["", "icon-button subtle", "node-pop-item"])("uses the same green badge on live success in %s", async className => {
    const onRegister = vi.fn(async () => undefined);
    await act(async () => root.render(<CanvasSeedanceRegistrationButton node={node} className={className} state={{ phase: "success" }} onRegister={onRegister} />));
    const button = container.querySelector("button")!;
    expect(button.classList.contains("is-success")).toBe(true);
    expect(button.querySelector("svg.lucide-badge-check")).not.toBeNull();
    expect(button.querySelector("svg.lucide-check")).toBeNull();
    expect(button.disabled).toBe(true);
    button.click();
    expect(onRegister).not.toHaveBeenCalled();
  });

  it.each(["pending", "error"] as const)("allows %s to be refreshed or retried with clear feedback", async phase => {
    const onRegister = vi.fn(async () => undefined);
    await act(async () => root.render(<CanvasSeedanceRegistrationButton node={node} onRegister={onRegister} state={{ phase, error: "网络错误" }} />));
    const button = container.querySelector("button")!;
    expect(button.disabled).toBe(false);
    expect(button.title).toContain(phase === "pending" ? "点击刷新状态" : "网络错误");
    await act(async () => button.click());
    expect(onRegister).toHaveBeenCalledOnce();
  });
});
