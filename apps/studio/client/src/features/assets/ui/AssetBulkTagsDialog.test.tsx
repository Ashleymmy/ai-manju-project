// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAssetTagDetails, type SemanticTag } from "@/entities/tag";
import { AssetBulkTagsDialog } from "./AssetBulkTagsDialog";

vi.mock("@/entities/tag", () => ({ listAssetTagDetails: vi.fn() }));
const ids = ["a", "b", "c"];

describe("bulk asset tags", () => {
  let root: Root;
  let container: HTMLDivElement;
  const save = vi.fn(); const close = vi.fn();
  const tags = [{ id: "parent", name: "角色", parent_id: "" }, { id: "child", name: "主角", parent_id: "parent" }] as SemanticTag[];
  const button = (text: string) => Array.from(document.querySelectorAll("button")).find(item => item.textContent === text)!;
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    save.mockReset(); close.mockReset();
    vi.mocked(listAssetTagDetails).mockReset();
    vi.mocked(listAssetTagDetails).mockImplementation(async (_scope, id) => ({ items: id === "c" ? [] : [{ tag: tags[0], binding: { id, asset_id: id, tag_id: "parent", state: "active" }, origins: [] }], total: 1 }));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<AssetBulkTagsDialog assetIds={ids} scope="personal" tags={tags} onSave={save} onClose={close} />));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  it("adds chosen tags independently of filters and closes only after saving", async () => {
    expect(button("确认添加").disabled).toBe(true);
    expect(document.body.textContent).toContain("角色 / 主角");
    await act(async () => (document.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).click());
    await act(async () => button("确认添加").click());
    expect(save).toHaveBeenCalledWith(["child"], "add", ids);
    expect(close).toHaveBeenCalledOnce();
  });
  it("keeps the chosen tags and dialog on a failed removal", async () => {
    save.mockRejectedValue(new Error("offline"));
    await act(async () => button("移除标签").click());
    await act(async () => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await act(async () => button("从 2 项资产移除").click());
    expect(save).toHaveBeenCalledWith(["parent"], "remove", ["a", "b"]);
    expect(close).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect((document.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  });
  it("only lists active existing tags, resets addition choices and deduplicates affected assets", async () => {
    vi.mocked(listAssetTagDetails).mockImplementation(async (_scope, id) => ({ items: tags.map(tag => ({ tag, binding: { id: `${id}:${tag.id}`, asset_id: id, tag_id: tag.id, state: id === "c" ? "suppressed" : "active" }, origins: [] })), total: 2 }));
    await act(async () => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await act(async () => button("移除标签").click());
    expect(button("从 0 项资产移除").disabled).toBe(true);
    expect(document.querySelectorAll(".asset-tag-coverage")).toHaveLength(2);
    expect(document.body.textContent).toContain("2/3 项");
    await act(async () => document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => input.click()));
    await act(async () => button("从 2 项资产移除").click());
    expect(save).toHaveBeenCalledWith(expect.arrayContaining(["parent", "child"]), "remove", ["a", "b"]);
  });
  it("hides unrelated catalog tags in removal mode", async () => {
    await act(async () => button("移除标签").click());
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    expect(document.querySelector(".asset-bulk-tag-list")!.textContent).not.toContain("主角");
    expect(listAssetTagDetails).toHaveBeenCalledWith("personal", "a", expect.any(AbortSignal));
  });
  it("does not expose partial results after a read failure and supports retry", async () => {
    vi.mocked(listAssetTagDetails).mockRejectedValueOnce(new Error("offline"));
    await act(async () => button("移除标签").click());
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(button("从 0 项资产移除").disabled).toBe(true);
    await act(async () => button("重新读取").click());
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  });
  it("shows an explicit empty state when none of the selected assets have tags", async () => {
    vi.mocked(listAssetTagDetails).mockResolvedValue({ items: [], total: 0 });
    await act(async () => button("移除标签").click());
    expect(document.body.textContent).toContain("所选资产暂无可移除的标签");
    expect(button("从 0 项资产移除").disabled).toBe(true);
  });
});
