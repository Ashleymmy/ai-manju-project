import type { ComponentProps } from "react";
import { CanvasAssetPickerDialog } from "./CanvasAssetPickerDialog";
import { CanvasConnectSelectionDialog, CanvasDestructiveDialogs } from "./CanvasConfirmationDialogs";
import { CanvasImageToolDialog } from "./CanvasDialogs";
import {
  CanvasAnnotationMaskDialogs,
  CanvasImagePreviewDialog,
  CanvasMentionPreviewDialog,
  CanvasStoryboardDialog,
} from "./CanvasPreviewDialogs";

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
    <>
      <CanvasImageToolDialog {...imageTool} />
      <CanvasAnnotationMaskDialogs {...annotationMask} />
      <CanvasStoryboardDialog {...storyboard} />
      <CanvasImagePreviewDialog {...imagePreview} />
      <CanvasMentionPreviewDialog {...mentionPreview} />
      <CanvasAssetPickerDialog {...assetPicker} />
      <CanvasConnectSelectionDialog {...connectSelection} />
      <CanvasDestructiveDialogs {...destructive} />
    </>
  );
}
