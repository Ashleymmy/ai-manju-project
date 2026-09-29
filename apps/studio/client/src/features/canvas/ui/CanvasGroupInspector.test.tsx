// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvasGroup } from "../domain/groups";
import type { CanvasNodeData } from "../domain/types";
import { CanvasInspector, type CanvasInspectorProps } from "./CanvasInspector";

// Pricing is unrelated to selection and must not issue quote requests in this UI test.
vi.mock("./CanvasGenerationPrice", () => ({
  CanvasGenerationPrice: () => <span>积分报价</span>,
}));

describe("group inspector with imported members", () => {
  let root: Root;
  let container: HTMLDivElement;
  const updateCanvasGroup = vi.fn();
  const runCanvasGroupGeneration = vi.fn();
  const ungroupCanvasGroup = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function renderInspector(kind: CanvasNodeData["kind"], grouped = true) {
    const imported: CanvasNodeData = {
      id: "imported",
      kind,
      title: "导入素材",
      content: "",
      x: 0,
      y: 0,
      width: 320,
      height: 240,
      metadata: { canvasOrigin: "imported" },
    };
    const generated: CanvasNodeData = {
      ...imported,
      id: "generated",
      kind: "image",
      title: "生成图片",
      x: 400,
      metadata: {},
    };
    const nodes = [imported, generated];
    const group = createCanvasGroup(
      nodes,
      nodes.map(node => node.id),
      "group",
      "分组1"
    )!;
    const actions = {
      node: { mentionReferencesForNode: () => [] },
      updateCanvasGroup,
      runCanvasGroupGeneration,
      ungroupCanvasGroup,
    } as unknown as CanvasInspectorProps["actions"];
    return (
      <CanvasInspector
        panelRef={createRef()}
        selectedNode={imported}
        selectedGroup={grouped ? group : undefined}
        inspectorOpen
        projectActionDisabled={false}
        selectedPanelStyle={{ left: 16, top: 16 }}
        selectedGroupPanelStyle={{ left: 16, top: 16 }}
        nodes={nodes}
        edges={[]}
        previews={{}}
        visiblePromptPresets={[]}
        imageToolBusy={false}
        storyboardBusy={false}
        selectedGenerationMode="image"
        selectedGenerationModel="gpt-image-2"
        selectedGenerationModelLabel="GPT Image"
        generationModelOptions={[]}
        selectedVideoConfig={null}
        selectedVideoSeedance={false}
        selectedVideoDurations={[]}
        selectedVideoResolutions={[]}
        selectedVideoRatios={[]}
        selectedAudioConfig={null}
        audioVoiceOptions={[]}
        audioFormatOptions={[]}
        runningGroupId=""
        runningNodeIds={new Set()}
        captureFrameNodeId=""
        styleCategory=""
        promptOptimizing={false}
        enabledSkills={[]}
        actions={actions}
      />
    );
  }

  it.each(["image", "video", "audio", "text"] as const)(
    "keeps the group toolbar independent from its primary imported %s member",
    async kind => {
      await act(async () => root.render(renderInspector(kind)));
      const panel = container.querySelector(".inspector-group")!;
      // This class carries display:none!important for standalone imported nodes.
      expect(panel.classList.contains("inspector-imported-node")).toBe(false);
      expect(panel.querySelector(".inspector-imported-preview")).toBeNull();
      expect(panel.textContent).toContain("分组名称");
      expect(panel.querySelector("input")?.value).toBe("分组1");
      expect(panel.querySelector('[aria-label="分组颜色"]')).not.toBeNull();
      expect(panel.textContent).toContain("积分明细");
      const buttons = [...panel.querySelectorAll("button")];
      const swatch = panel.querySelector<HTMLButtonElement>(
        ".canvas-group-color-swatch"
      )!;
      await act(async () => swatch.click());
      expect(updateCanvasGroup).toHaveBeenCalledWith(expect.any(String), {
        color: expect.any(String),
      });
      await act(async () =>
        buttons
          .find(button => button.textContent?.includes("批量执行分组"))!
          .click()
      );
      await act(async () =>
        buttons
          .find(button => button.textContent?.includes("解散分组"))!
          .click()
      );
      expect(runCanvasGroupGeneration).toHaveBeenCalledWith(
        updateCanvasGroup.mock.calls[0][0]
      );
      expect(ungroupCanvasGroup).toHaveBeenCalledWith(
        updateCanvasGroup.mock.calls[0][0]
      );
    }
  );

  it("retains standalone imported-node behavior after leaving group selection", async () => {
    await act(async () => root.render(renderInspector("image")));
    await act(async () => root.render(renderInspector("image", false)));
    expect(container.querySelector(".inspector-group")).toBeNull();
    expect(
      container.querySelector(
        ".inspector-imported-node .inspector-imported-preview"
      )
    ).not.toBeNull();
    await act(async () => root.render(renderInspector("image")));
    expect(container.querySelector(".inspector-imported-node")).toBeNull();
    expect(container.textContent).toContain("分组名称");
  });
});
