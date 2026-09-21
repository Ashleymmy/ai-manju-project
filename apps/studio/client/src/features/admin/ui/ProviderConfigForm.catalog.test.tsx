// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  ProviderConfigForm,
  mergeConfigDocument,
  toConfigDocument,
  type ProviderRecord,
} from "@ai-manju/provider-hub";

describe("large provider model catalogs", () => {
  it("searches every model, keeps all pages when saving, and locates added or duplicate IDs", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const ids = Array.from(
      { length: 601 },
      (_, i) => `video-${String(i).padStart(3, "0")}`
    );
    type CatalogProvider = ProviderRecord & { model_aliases: Record<string, string> };
    const initial: CatalogProvider = {
      name: "Catalog",
      enabled: true,
      base_url: "https://example.invalid/v1",
      capabilities: ["video", "text"],
      video_model: ids[0],
      text_model: "MiniMax-M2.5",
      models_by_capability: { video: ids, text: ["MiniMax-M2.5"] },
      model_aliases: { [ids[600]]: "海螺最后一个模型" },
    };
    let saved: CatalogProvider | undefined;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    function Harness() {
      const [draft, setDraft] = useState(initial);
      return (
        <ProviderConfigForm
          document={toConfigDocument(draft)}
          onChange={document =>
            setDraft(current => mergeConfigDocument(current, document))
          }
          onSave={() => {
            saved = draft;
          }}
        />
      );
    }
    const button = (label: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        element =>
          element.textContent === label ||
          element.getAttribute("aria-label") === label
      )!;
    const input = (label: string) =>
      container.querySelector<HTMLInputElement>(
        `input[aria-label="${label}"]`
      )!;
    const fill = async (label: string, value: string) => {
      await act(async () => {
        const element = input(label);
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )!.set!.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    try {
      await act(async () => root.render(<Harness />));
      expect(container.textContent).toContain("共 601 个视频模型");
      expect(container.querySelectorAll(".hub-model-entry")).toHaveLength(50);
      expect(container.querySelector('[title="video-600"]')).toBeNull();
      await act(async () => button("下一页").click());
      expect(container.querySelector('[title="video-050"]')).not.toBeNull();
      await fill("搜索已配置模型", "海螺");
      expect(container.querySelectorAll(".hub-model-entry")).toHaveLength(1);
      expect(container.querySelector('[title="video-600"]')).not.toBeNull();
      await fill("video-600 显示名称", "MiniMax H3");
      await fill("搜索已配置模型", "找不到的名称");
      await fill("新模型 ID", "minimax-h3，minimax-h3-fast;minimax-h3");
      await act(async () => button("添加").click());
      expect(input("新模型 ID").value).toBe("");
      expect(input("搜索已配置模型").value).toBe("");
      expect(container.textContent).toContain("共 603 个视频模型");
      expect(container.textContent).toContain("已添加 2 个视频模型");
      expect(container.querySelector('[title="minimax-h3"]')).not.toBeNull();
      await fill("新模型 ID", "minimax-h3");
      await act(async () =>
        input("新模型 ID").dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        )
      );
      expect(container.textContent).toContain("模型已在当前类别中");
      expect(container.textContent).toContain("共 603 个视频模型");
      await act(async () => button("文本 / LLM").click());
      expect(input("搜索已配置模型").value).toBe("");
      expect(container.querySelector('[title="MiniMax-M2.5"]')).not.toBeNull();
      await act(async () => button("视频").click());
      await fill("搜索已配置模型", "MiniMax H3");
      expect(container.querySelector('[title="video-600"]')).not.toBeNull();
      await act(async () => button("保存配置").click());
      expect(saved?.models_by_capability?.video).toEqual([
        ...ids,
        "minimax-h3",
        "minimax-h3-fast",
      ]);
      expect(saved?.models_by_capability?.text).toEqual(["MiniMax-M2.5"]);
      expect(saved?.model_aliases).toMatchObject({ "video-600": "MiniMax H3" });
      expect(saved?.video_model).toBe(ids[0]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
