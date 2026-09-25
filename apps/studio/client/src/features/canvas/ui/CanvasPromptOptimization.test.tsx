// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasNodeData } from "../domain/types";
import type { CanvasPromptOptimizationReceipt } from "../domain/promptOptimizationReceipt";
import { CanvasInspector, type CanvasInspectorProps } from "./CanvasInspector";

vi.mock("@/features/member", async original => ({ ...(await original<typeof import("@/features/member")>()), GenerationPrice: () => <span>报价</span> }));

describe("prompt optimization recovery controls", () => {
  let root: Root;
  let container: HTMLDivElement;
  const optimize = vi.fn();
  const generate = vi.fn();
  const receipt: CanvasPromptOptimizationReceipt = { version: 1, key: "original", userId: "one", scope: "personal", projectId: "project",
    projectKey: "personal:project", nodeId: "node", kind: "image", prompt: "原提示词", model: "text", state: "pending" };
  async function render(value: CanvasPromptOptimizationReceipt) {
    const node: CanvasNodeData = { id: "node", kind: "image", title: "图片", content: "新的提示词", x: 0, y: 0, width: 320, height: 240,
      metadata: { imageResolution: "1K", size: "auto", quality: "low", promptOptimizationReceipt: value } };
    const actions = { node: { mentionReferencesForNode: () => [] }, onSkillsOpen: vi.fn(),
      optimizeNodePrompt: optimize, generateFromNode: generate } as unknown as CanvasInspectorProps["actions"];
    await act(async () => root.render(<CanvasInspector panelRef={createRef()} selectedNode={node} inspectorOpen projectActionDisabled={false}
      selectedPanelStyle={{ display: "block" }} nodes={[node]} edges={[]} previews={{}} visiblePromptPresets={[]}
      imageToolBusy={false} storyboardBusy={false} selectedGenerationMode="image" selectedGenerationModel="gpt-image-2"
      selectedGenerationModelLabel="GPT Image" generationModelOptions={[]} selectedVideoConfig={null}
      selectedVideoSeedance={false} selectedVideoDurations={[]} selectedVideoResolutions={[]} selectedVideoRatios={[]}
      selectedAudioConfig={null} audioVoiceOptions={[]} audioFormatOptions={[]} runningGroupId="" runningNodeIds={new Set()}
      captureFrameNodeId="" styleCategory="" promptOptimizing={false} enabledSkills={[{ id: "style", title: "电影感", prompt: "电影风格" }]}
      actions={actions} />));
    return node;
  }
  async function clickText(label: string) {
    const target = Array.from(document.querySelectorAll("button")).find(button => button.textContent?.trim() === label);
    expect(target).toBeTruthy();
    await act(async () => target!.click());
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    optimize.mockReset(); generate.mockReset();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it("offers original-result recovery without blocking normal image generation or calling a model on render", async () => {
    const node = await render(receipt);
    expect(optimize).not.toHaveBeenCalled();
    const generation = container.querySelector<HTMLButtonElement>('[aria-label="生成"]')!;
    expect(generation.disabled).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('[title="恢复原优化结果"]')!.click());
    expect(document.body.textContent).not.toContain("电影感");
    await clickText("恢复原优化结果");
    expect(optimize).toHaveBeenCalledOnce();
    expect(optimize).toHaveBeenCalledWith(node);
    expect(generate).not.toHaveBeenCalled();
  });

  it("previews the retained suggestion and explicitly labels replacing the edited prompt", async () => {
    const node = await render({ ...receipt, state: "received", result: "已保留的原回复", applied: false });
    await act(async () => container.querySelector<HTMLButtonElement>('[title="查看优化结果"]')!.click());
    const output = document.querySelector<HTMLTextAreaElement>("#canvas-prompt-optimization-result")!;
    expect(output.value).toBe("已保留的原回复"); expect(output.readOnly).toBe(true);
    expect(document.body.textContent).toContain("采用后替换当前提示词");
    expect(optimize).not.toHaveBeenCalled();
    await clickText("采用优化结果");
    expect(optimize).toHaveBeenCalledOnce();
    expect(optimize).toHaveBeenCalledWith(node);
  });

  it.each(["failed", "received"] as const)("allows a deliberate new optimization after %s is resolved", async state => {
    await render({ ...receipt, state, result: state === "received" ? "已采用的结果" : undefined, applied: state === "received" });
    await act(async () => container.querySelector<HTMLButtonElement>('[title="优化提示词"]')!.click());
    expect(document.body.textContent).toContain("默认优化");
    expect(document.body.textContent).toContain("电影感");
    expect(document.querySelector("#canvas-prompt-optimization-result")).toBeNull();
  });
});
