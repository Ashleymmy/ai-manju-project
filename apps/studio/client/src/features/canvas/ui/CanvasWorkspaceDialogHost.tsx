import type { ComponentProps } from "react";
import AgentPanel from "@/components/AgentPanel";
import PromptLibraryDialog from "@/components/PromptLibraryDialog";
import PromptPresetManagerDialog from "@/components/PromptPresetManagerDialog";
import SkillLibraryDialog from "@/components/SkillLibraryDialog";
import StoryboardEditorDialog from "@/components/StoryboardEditorDialog";
import { CanvasSeedanceAssetDialog } from "@/components/canvas/CanvasSeedanceAssetDialog";
import { CanvasSeedanceMaterialDialog } from "@/components/canvas/CanvasSeedanceMaterialDialog";

export type CanvasWorkspaceDialogHostProps = {
  agent: ComponentProps<typeof AgentPanel>;
  skillLibrary: ComponentProps<typeof SkillLibraryDialog>;
  presetManager: ComponentProps<typeof PromptPresetManagerDialog>;
  storyboardEditor: ComponentProps<typeof StoryboardEditorDialog>;
  promptLibrary: ComponentProps<typeof PromptLibraryDialog>;
  seedanceMaterial: ComponentProps<typeof CanvasSeedanceMaterialDialog>;
  seedanceAsset: ComponentProps<typeof CanvasSeedanceAssetDialog>;
};

export function CanvasWorkspaceDialogHost({
  agent,
  skillLibrary,
  presetManager,
  storyboardEditor,
  promptLibrary,
  seedanceMaterial,
  seedanceAsset,
}: CanvasWorkspaceDialogHostProps) {
  return (
    <>
      <AgentPanel {...agent} />
      <SkillLibraryDialog {...skillLibrary} />
      <PromptPresetManagerDialog {...presetManager} />
      <StoryboardEditorDialog {...storyboardEditor} />
      <PromptLibraryDialog {...promptLibrary} />
      <CanvasSeedanceMaterialDialog {...seedanceMaterial} />
      <CanvasSeedanceAssetDialog {...seedanceAsset} />
    </>
  );
}
