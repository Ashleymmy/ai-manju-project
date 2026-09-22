// @vitest-environment jsdom
import { act, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCanvasMentionReferences } from "../domain/mentions";
import { promptTextFromNode } from "../domain/nodeUtils";
import type { CanvasNodeData, CanvasNodeKind } from "../domain/types";
import { CanvasInspector, type CanvasInspectorProps } from "./CanvasInspector";

const source: CanvasNodeData = {
  id: "source", kind: "image", title: "参考图", content: "", x: 0, y: 0, width: 320, height: 240,
  imageAssetId: "image-asset", imageSrc: "data:image/png;base64,AA==",
};
const kinds: CanvasNodeKind[] = ["image", "video", "audio", "text", "prompt", "note", "config", "director"];

describe("Inspector connected thumbnails", () => {
  let root: Root;
  let container: HTMLDivElement;
  let update: ReturnType<typeof vi.fn>;
  let preview: ReturnType<typeof vi.fn>;
  let generate: ReturnType<typeof vi.fn>;
  function Harness({ kind = "image", id = "target" }: { kind?: CanvasNodeKind; id?: string }) {
    const [prompts, setPrompts] = useState<Record<string, string>>({ target: "原提示词", second: "另一节点" });
    const selected: CanvasNodeData = { id, kind, title: id, content: "", x: 400, y: 0, width: 320, height: 240, metadata: { composerContent: prompts[id] } };
    const ancestor: CanvasNodeData = { ...source, id: "ancestor", title: "更前置的参考图" };
    const nodes = [ancestor, source, selected];
    const edges = [{ id: "earlier", from: ancestor.id, to: source.id }, { id: "edge", from: source.id, to: id }];
    // Unused toolbar actions are inert; the editor, reference builder and click handler are real.
    const actions = {
      node: {
        mentionReferencesForNode: (nodeId: string) => buildCanvasMentionReferences(nodeId, nodes, edges, [], "personal"),
        mentionThumbnailFor: () => source.imageSrc!,
        setImagePreviewNodeId: preview,
        previewMentionReference: preview,
        updateNodePrompt: (nodeId: string, value: string) => {
          update(nodeId, value);
          setPrompts(current => ({ ...current, [nodeId]: value }));
        },
      },
      generateFromNode: generate,
    } as unknown as CanvasInspectorProps["actions"];
    return <>
      <CanvasInspector panelRef={createRef()} selectedNode={selected} inspectorOpen projectActionDisabled={false}
        selectedPanelStyle={{ display: "block" }} nodes={nodes} edges={edges} previews={{}} visiblePromptPresets={[]}
        imageToolBusy={false} storyboardBusy={false} selectedGenerationMode="image" selectedGenerationModel="" selectedGenerationModelLabel=""
        generationModelOptions={[]} selectedVideoConfig={null} selectedVideoSeedance={false} selectedVideoDurations={[]}
        selectedVideoResolutions={[]} selectedVideoRatios={[]} selectedAudioConfig={null} audioVoiceOptions={[]} audioFormatOptions={[]}
        runningGroupId="" runningNodeIds={new Set()} captureFrameNodeId="" styleCategory="" promptOptimizing={false} enabledSkills={[]} actions={actions} />
      <output>{promptTextFromNode(selected)}</output>
    </>;
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    update = vi.fn(); preview = vi.fn(); generate = vi.fn();
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
  const thumbnail = () => container.querySelector<HTMLButtonElement>(".canvas-connected-preview")!;
  const textarea = () => container.querySelector<HTMLTextAreaElement>("textarea.node-card-prompt")!;

  it.each(kinds)("inserts the real node reference into a %s prompt without previewing or generating", async kind => {
    await act(async () => root.render(<Harness kind={kind} />));
    await act(async () => thumbnail().click());
    expect(update).toHaveBeenLastCalledWith("target", "原提示词@[node:source]");
    expect(container.querySelector("output")?.textContent).toBe("原提示词@[node:source]");
    expect(container.querySelectorAll("[data-mention-chip]")).toHaveLength(1);
    expect(document.activeElement).toBe(textarea());
    expect(textarea().selectionStart).toBe(textarea().value.length);
    expect(preview).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it.each(kinds)("shows only direct predecessors in the %s mention popup", async kind => {
    await act(async () => root.render(<Harness kind={kind} />));
    await act(async () => {
      textarea().focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), "@");
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
    const rows = [...document.querySelectorAll(".canvas-mention-item:not(.canvas-mention-item-folder)")];
    expect(rows.map(row => row.querySelector("strong")?.textContent)).toEqual(["参考图"]);
    await act(async () => rows[0].dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenLastCalledWith("target", "@[node:source]");
    expect(preview).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps the caret when pressing the thumbnail and resets it when selecting another node", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => { textarea().focus(); textarea().setSelectionRange(1, 1); });
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    await act(async () => thumbnail().dispatchEvent(press));
    expect(press.defaultPrevented).toBe(true);
    await act(async () => thumbnail().click());
    expect(update).toHaveBeenLastCalledWith("target", "原@[node:source]提示词");
    await act(async () => root.render(<Harness id="second" />));
    await act(async () => thumbnail().click());
    expect(update).toHaveBeenLastCalledWith("second", "另一节点@[node:source]");
    await act(async () => root.render(<Harness />));
    expect(container.querySelector("output")?.textContent).toBe("原@[node:source]提示词");
    expect(preview).not.toHaveBeenCalled();
  });
});

vi.mock("@/features/member", async original => ({ ...(await original<typeof import("@/features/member")>()), GenerationPrice: () => <span>报价</span> }));
