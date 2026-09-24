// @vitest-environment jsdom
import { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { replaceVideoModelCapabilities } from "@/entities/model/videoCapabilities";
import { videoConfigFromNode } from "../domain/nodeUtils";
import type { CanvasNodeData } from "../domain/types";
import { CanvasInspector, type CanvasInspectorProps } from "./CanvasInspector";

vi.mock("./CanvasGenerationPrice", () => ({ CanvasGenerationPrice: () => null }));
afterEach(() => { replaceVideoModelCapabilities({}); vi.unstubAllGlobals(); });

it.each(["sdvideo/seedance-2.0-mini", "sdvideo/seedance-fast", "mt::ep-mini"])("makes 1080p visibly disabled and unclickable for %s", async model => {
  replaceVideoModelCapabilities({ [model]: { resolutions: ["480p", "720p"] } });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const changed = vi.fn();
  function Harness() {
    const [node, setNode] = useState<CanvasNodeData>({ id: "video", kind: "video", title: "Video", content: "", x: 0, y: 0, width: 320, height: 240, metadata: { model, generationMode: "video", resolution: "1080p", size: "1:1", seconds: "5" } });
    const actions = { node: { mentionReferencesForNode: () => [] }, updateNode: (_id: string, patch: Partial<CanvasNodeData>) => { changed(patch); setNode(current => ({ ...current, ...patch })); } } as unknown as CanvasInspectorProps["actions"];
    return <CanvasInspector panelRef={createRef()} selectedNode={node} inspectorOpen projectActionDisabled={false}
      selectedPanelStyle={{ display: "block" }} nodes={[node]} edges={[]} previews={{}} visiblePromptPresets={[]}
      imageToolBusy={false} storyboardBusy={false} selectedGenerationMode="video" selectedGenerationModel={model}
      selectedGenerationModelLabel="Video" generationModelOptions={[]} selectedVideoConfig={videoConfigFromNode(node, model)}
      selectedVideoSeedance selectedVideoDurations={[4, 5, 6]} selectedVideoResolutions={["480p", "720p", "1080p"]} selectedVideoRatios={["16:9", "1:1"]}
      selectedAudioConfig={null} audioVoiceOptions={[]} audioFormatOptions={[]} runningGroupId="" runningNodeIds={new Set()}
      captureFrameNodeId="" styleCategory="" promptOptimizing={false} enabledSkills={[]} actions={actions} />;
  }
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness />));
    const button = (text: string) => [...document.querySelectorAll("button")].find(item => item.textContent?.trim() === text)!;
    await act(async () => button("参数").click());
    expect(button("1080p").disabled).toBe(true);
    await act(async () => button("1080p").click());
    expect(changed).not.toHaveBeenCalled();
    expect(button("720p").disabled).toBe(false);
    expect(button("1:1").disabled).toBe(false);
    await act(async () => button("480p").click());
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ resolution: "480p" }) }));
  } finally { await act(async () => root.unmount()); container.remove(); }
});
