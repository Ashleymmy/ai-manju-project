// @vitest-environment jsdom
import { act, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canvasImageGenerationSettings } from "../domain/imageGenerationSettings";
import type { CanvasNodeData } from "../domain/types";
import { CanvasInspector, type CanvasInspectorProps } from "./CanvasInspector";

describe("canvas image parameter controls", () => {
  let root: Root;
  let container: HTMLDivElement;
  const submit = vi.fn();
  function Harness() {
    const [node, setNode] = useState<CanvasNodeData>({
      id: "character", kind: "image", title: "人物", content: "发丝清晰", x: 0, y: 0, width: 320, height: 240,
      metadata: { imageResolution: "1K", size: "auto", quality: "low" },
    });
    const actions = {
      node: { mentionReferencesForNode: () => [] },
      updateNode: (_id: string, patch: Partial<CanvasNodeData>) => setNode(current => ({ ...current, ...patch })),
      generateFromNode: () => submit(canvasImageGenerationSettings(node)),
    } as unknown as CanvasInspectorProps["actions"];
    return <CanvasInspector panelRef={createRef()} selectedNode={node} inspectorOpen projectActionDisabled={false}
      selectedPanelStyle={{ display: "block" }} nodes={[node]} edges={[]} previews={{}} visiblePromptPresets={[]}
      imageToolBusy={false} storyboardBusy={false} selectedGenerationMode="image" selectedGenerationModel="gpt-image-2"
      selectedGenerationModelLabel="GPT Image" generationModelOptions={[]} selectedVideoConfig={null}
      selectedVideoSeedance={false} selectedVideoDurations={[]} selectedVideoResolutions={[]} selectedVideoRatios={[]}
      selectedAudioConfig={null} audioVoiceOptions={[]} audioFormatOptions={[]} runningGroupId="" runningNodeIds={new Set()}
      captureFrameNodeId="" styleCategory="" promptOptimizing={false} enabledSkills={[]} actions={actions} />;
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    submit.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  async function click(label: string) {
    const button = Array.from(document.querySelectorAll("button")).find(item => item.textContent?.trim() === label);
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  }
  it("changes the displayed pixels and generation settings through the actual parameter buttons", async () => {
    await act(async () => root.render(<Harness />));
    await click("参数");
    expect(document.body.textContent).toContain("请求尺寸：1024 × 1024 px");
    await click("4K");
    await click("16:9");
    await click("高");
    expect(document.body.textContent).toContain("请求尺寸：3840 × 2160 px");
    const generate = container.querySelector<HTMLButtonElement>(".node-send-button");
    expect(generate).toBeTruthy();
    await act(async () => generate!.click());
    expect(submit).toHaveBeenLastCalledWith({ size: "3840x2160", quality: "high", imageResolution: "4K" });
    await click("参数");
    await click("2K");
    await click("4:3");
    expect(document.body.textContent).toContain("请求尺寸：2352 × 1760 px");
    await act(async () => generate!.click());
    expect(submit).toHaveBeenLastCalledWith({ size: "2352x1760", quality: "high", imageResolution: "2K" });
  });
});
