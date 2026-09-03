import { lazy, Suspense, type ComponentProps } from "react";

const AgentPanel = lazy(() => import("@/components/AgentPanel"));
const PromptLibraryDialog = lazy(() => import("@/components/PromptLibraryDialog"));
const PromptPresetManagerDialog = lazy(() => import("@/components/PromptPresetManagerDialog"));
const SkillLibraryDialog = lazy(() => import("@/components/SkillLibraryDialog"));
const StoryboardEditorDialog = lazy(() => import("@/components/StoryboardEditorDialog"));
const CanvasSeedanceAssetDialog = lazy(() => import("@/components/canvas/CanvasSeedanceAssetDialog").then((module) => ({ default: module.CanvasSeedanceAssetDialog })));
const CanvasSeedanceMaterialDialog = lazy(() => import("@/components/canvas/CanvasSeedanceMaterialDialog").then((module) => ({ default: module.CanvasSeedanceMaterialDialog })));

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
      <Suspense fallback={null}>
        <AgentPanel {...agent} />
      </Suspense>
      <SkillLibraryDialog {...skillLibrary} />
      <PromptPresetManagerDialog {...presetManager} />
      <StoryboardEditorDialog {...storyboardEditor} />
      <PromptLibraryDialog {...promptLibrary} />
      <CanvasSeedanceMaterialDialog {...seedanceMaterial} />
      <CanvasSeedanceAssetDialog {...seedanceAsset} />
    </>
  );
}
