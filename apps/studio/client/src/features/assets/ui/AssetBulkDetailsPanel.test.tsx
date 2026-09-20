// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "@/entities/asset";
import { AssetBulkDetailsPanel } from "./AssetBulkDetailsPanel";

vi.mock("./AssetThumbnail", () => ({ AssetThumbnail: ({ name }: { name: string }) => <span>{name}</span> }));
const assets: Asset[] = [
  { id: "a", name: "a.png", type: "image", category: "character" },
  { id: "b", name: "b.png", type: "image", category: "other" },
];

describe("asset bulk detail panel", () => {
  let root: Root;
  let container: HTMLDivElement;
  const save = vi.fn();
  const editTags = vi.fn();
  const button = (text: string) => Array.from(container.querySelectorAll("button")).find(item => item.textContent?.includes(text))!;
  const render = async (readOnly = false, items = assets) => act(async () => root.render(<AssetBulkDetailsPanel assets={items} scope="personal" readOnly={readOnly} onSaveCategory={save} onEditTags={editTags} />));
  const choose = async (category: string) => act(async () => { const select = container.querySelector("select")!; select.value = category; select.dispatchEvent(new Event("change", { bubbles: true })); });
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    save.mockReset(); editTags.mockReset();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await render();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it("requires an explicit category for mixed selections and edits tags from the sidebar", async () => {
    expect(container.textContent).toContain("已选择 2 项资产");
    expect(button("应用到").disabled).toBe(true);
    await act(async () => button("编辑所选资产标签").click());
    expect(editTags).toHaveBeenCalledOnce();
    save.mockResolvedValue({ updated: assets, failedIds: [] });
    await choose("environment");
    await act(async () => button("应用到").click());
    expect(save).toHaveBeenCalledWith(["a", "b"], "environment");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("已更新 2 项");
  });

  it("retries only failed items and clears that retry set when category changes", async () => {
    save.mockResolvedValueOnce({ updated: [assets[0]], failedIds: ["b"] }).mockResolvedValueOnce({ updated: [], failedIds: ["b"] }).mockResolvedValue({ updated: assets, failedIds: [] });
    await choose("prop");
    await act(async () => button("应用到").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("1 项失败");
    await act(async () => button("重试失败").click());
    expect(save).toHaveBeenLastCalledWith(["b"], "prop");
    await choose("reference");
    await act(async () => button("应用到").click());
    expect(save).toHaveBeenLastCalledWith(["a", "b"], "reference");
  });

  it("prevents duplicate saves and tag edits while a request is pending", async () => {
    let resolve!: (value: unknown) => void;
    save.mockReturnValue(new Promise(done => { resolve = done; }));
    await choose("prop");
    await act(async () => { button("应用到").click(); button("应用到").click(); });
    expect(save).toHaveBeenCalledOnce();
    expect(container.querySelector("select")?.disabled).toBe(true);
    expect(button("编辑所选资产标签").disabled).toBe(true);
    await act(async () => resolve({ updated: assets, failedIds: [] }));
    expect(button("编辑所选资产标签").disabled).toBe(false);
  });

  it("does not expose edit controls for trashed assets", async () => {
    await render(true);
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.textContent).toContain("请先恢复");
  });
});
