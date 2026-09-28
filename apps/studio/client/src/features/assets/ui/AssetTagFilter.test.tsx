// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SemanticTag } from "@/entities/tag";
import { AssetTagFilter } from "./AssetTagFilter";

const tag = (id: string, name: string, parent_id = "", asset_enabled = true): SemanticTag => ({
  id, name, parent_id, asset_enabled, prompt_enabled: false, description: "", aliases: [],
  scope_type: "user", inherit_mode: "auto", status: "active", sort_order: 0,
  asset_count: 3, prompt_count: 0, children_count: 0, editable: true,
});
const tags = [tag("parent", "角色"), tag("child", "主角", "parent"), tag("leaf", "侦探", "child")];
let container: HTMLDivElement;
let root: Root;
const toggle = vi.fn();
const button = (label: string) => [...container.querySelectorAll("button")].find(item => item.getAttribute("aria-label") === label)!;
const render = (items = tags, selectedIds = ["leaf"]) => act(async () => root.render(<AssetTagFilter tags={items} selectedIds={selectedIds} match="and" onToggle={toggle} onClear={() => {}} onMatchChange={() => {}} />));
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  toggle.mockReset(); container = document.createElement("div"); document.body.append(container);
  root = createRoot(container); await render();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("separates navigation from filtering and closes with Escape while restoring the root trigger focus", async () => {
  expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  expect(container.querySelector(".asset-taxonomy-subpanel")).toBeNull();
  await act(async () => button("展开标签 角色").click());
  await act(async () => button("展开标签 角色 / 主角").click());
  expect(toggle).not.toHaveBeenCalled();
  expect(button("筛选标签 角色 / 主角 / 侦探").getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("筛选全部 角色 / 主角").click());
  expect(toggle).toHaveBeenCalledWith("child");
  await act(async () => button("筛选标签 角色 / 主角 / 侦探").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(container.querySelector(".asset-taxonomy-subpanel")).toBeNull();
  expect(document.activeElement).toBe(button("展开标签 角色"));
  expect(button("取消筛选 角色 / 主角 / 侦探")).toBeDefined();
});

it("updates paths after a move and safely hides a panel whose active parent was removed", async () => {
  await act(async () => button("展开标签 角色").click());
  await act(async () => button("展开标签 角色 / 主角").click());
  await render([tags[0], { ...tags[1], parent_id: "" }, tags[2]]);
  expect(button("筛选标签 主角 / 侦探")).toBeDefined();
  expect(button("取消筛选 主角 / 侦探")).toBeDefined();
  await render([tags[0]]);
  expect(container.querySelector(".asset-taxonomy-subpanel")).toBeNull();
  await act(async () => button("取消筛选 标签暂不可用").click());
  expect(toggle).toHaveBeenCalledWith("leaf");
});

it("keeps context-only parents browsable without allowing their assignment as a filter", async () => {
  await render([{ ...tags[0], asset_enabled: false }, ...tags.slice(1)]);
  expect(button("筛选标签 角色").disabled).toBe(true);
  expect(button("展开标签 角色").disabled).toBe(false);
  await act(async () => button("展开标签 角色").click());
  expect(button("筛选全部 角色").disabled).toBe(true);
  await act(async () => button("筛选标签 角色 / 主角").click());
  expect(toggle).toHaveBeenCalledWith("child");
});

it("keeps the tag ribbon expanded without an overall collapse control, including an empty catalog", async () => {
  expect(container.querySelector(".asset-taxonomy-content")).not.toBeNull();
  expect(button("筛选标签 角色")).toBeDefined();
  expect(button("收起分类标签")).toBeUndefined();
  expect(button("展开分类标签")).toBeUndefined();
  expect(container.querySelector(".asset-taxonomy-head [aria-expanded]")).toBeNull();
  await render([]);
  expect(container.textContent).toContain("暂无分类标签");
  expect(container.querySelector(".asset-taxonomy-content")).not.toBeNull();
  await act(async () => button("取消筛选 标签暂不可用").click());
  expect(toggle).toHaveBeenCalledWith("leaf");
});
