import { lazy, Suspense, type ComponentProps } from "react";

const CanvasAssetPickerDialog = lazy(() => import("./CanvasAssetPickerDialog").then(module => ({ default: module.CanvasAssetPickerDialog })));
const CanvasConnectSelectionDialog = lazy(() => import("./CanvasConfirmationDialogs").then(module => ({ default: module.CanvasConnectSelectionDialog })));
const CanvasDestructiveDialogs = lazy(() => import("./CanvasConfirmationDialogs").then(module => ({ default: module.CanvasDestructiveDialogs })));
const CanvasImageToolDialog = lazy(() => import("./CanvasDialogs").then(module => ({ default: module.CanvasImageToolDialog })));
const CanvasAnnotationMaskDialogs = lazy(() => import("./CanvasPreviewDialogs").then(module => ({ default: module.CanvasAnnotationMaskDialogs })));
const CanvasImagePreviewDialog = lazy(() => import("./CanvasPreviewDialogs").then(module => ({ default: module.CanvasImagePreviewDialog })));
const CanvasMentionPreviewDialog = lazy(() => import("./CanvasPreviewDialogs").then(module => ({ default: module.CanvasMentionPreviewDialog })));
const CanvasStoryboardDialog = lazy(() => import("./CanvasPreviewDialogs").then(module => ({ default: module.CanvasStoryboardDialog })));

export type CanvasDialogHostProps = {
  imageTool: ComponentProps<typeof CanvasImageToolDialog>;
  annotationMask: ComponentProps<typeof CanvasAnnotationMaskDialogs>;
  storyboard: ComponentProps<typeof CanvasStoryboardDialog>;
  imagePreview: ComponentProps<typeof CanvasImagePreviewDialog>;
  mentionPreview: ComponentProps<typeof CanvasMentionPreviewDialog>;
  assetPicker: ComponentProps<typeof CanvasAssetPickerDialog>;
  connectSelection: ComponentProps<typeof CanvasConnectSelectionDialog>;
  destructive: ComponentProps<typeof CanvasDestructiveDialogs>;
};

export function CanvasDialogHost({
  imageTool,
  annotationMask,
  storyboard,
  imagePreview,
  mentionPreview,
  assetPicker,
  connectSelection,
  destructive,
}: CanvasDialogHostProps) {
  return (
    <Suspense fallback={null}>
      <CanvasImageToolDialog {...imageTool} />
      <CanvasAnnotationMaskDialogs {...annotationMask} />
      <CanvasStoryboardDialog {...storyboard} />
      <CanvasImagePreviewDialog {...imagePreview} />
      <CanvasMentionPreviewDialog {...mentionPreview} />
      <CanvasAssetPickerDialog {...assetPicker} />
      <CanvasConnectSelectionDialog {...connectSelection} />
      <CanvasDestructiveDialogs {...destructive} />
    </Suspense>
  );
}
