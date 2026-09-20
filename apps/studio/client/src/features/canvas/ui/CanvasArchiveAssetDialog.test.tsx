// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasArchiveAssetDialog } from "./CanvasArchiveAssetDialog";

describe("canvas archive category dialog", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onSave = vi.fn(async (_category: string) => {});
  const onOpenChange = vi.fn();
  const button = (label: string) => [...document.querySelectorAll("button")].find(item => item.textContent === label)!;
  async function render(key = "node") {
    await act(async () => root.render(<CanvasArchiveAssetDialog open nodeKey={key} assetName="风景" projectTitle="第一集" onOpenChange={onOpenChange} onSave={onSave} />));
  }
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await render();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it("offers all four folders with other selected by default", async () => {
    expect([...document.querySelectorAll('[role="radio"]')].map(item => item.textContent)).toEqual(["角色", "场景", "道具", "其他"]);
    expect(button("其他").getAttribute("aria-checked")).toBe("true");
    await act(async () => button("确认加入").click());
    expect(onSave).toHaveBeenCalledWith("other");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("saves the selected folder, prevents duplicate submits and retains the selection for retry", async () => {
    let reject!: (error: Error) => void;
    onSave.mockImplementationOnce(() => new Promise<void>((_resolve, rejectSave) => { reject = rejectSave; }));
    await act(async () => button("场景").click());
    await act(async () => { button("确认加入").click(); button("确认加入").click(); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("environment");
    expect(button("角色").disabled).toBe(true);
    expect(button("取消").disabled).toBe(true);
    await act(async () => reject(new Error("保存失败")));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("保存失败");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(button("场景").getAttribute("aria-checked")).toBe("true");
    await act(async () => button("确认加入").click());
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not save on cancel and resets the destination for the next node", async () => {
    await act(async () => { button("角色").click(); button("取消").click(); });
    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await render("next-node");
    expect(button("其他").getAttribute("aria-checked")).toBe("true");
  });
});
