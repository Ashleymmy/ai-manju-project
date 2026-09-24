import type { CanvasNodeData } from "../domain/types";
import { canvasImageGenerationError } from "../domain/imageGenerationError";

/** Compare against the submitted request, never against settings edited afterwards. */
export function CanvasImageOutputStatus({ node }: { node: CanvasNodeData }) {
  if (node.kind !== "image") return null;
  if (node.metadata?.status === "error" && node.metadata.errorDetails) {
    return (
      <p role="alert" className="px-3 py-2 text-xs text-red-300">
        {canvasImageGenerationError(node.metadata.errorDetails)}
      </p>
    );
  }
  if (node.metadata?.status !== "success") return null;
  const requested = /^(\d+)x(\d+)$/.exec(
    String(node.metadata.requestedImageSize || "")
  );
  const width = Number(node.metadata.naturalWidth);
  const height = Number(node.metadata.naturalHeight);
  if (
    !requested ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return null;
  const requestedWidth = Number(requested[1]);
  const requestedHeight = Number(requested[2]);
  if (width === requestedWidth && height === requestedHeight) return null;
  return (
    <p role="status" className="px-3 py-2 text-xs text-amber-300">
      原图实际尺寸为 {width} × {height} px，本次请求尺寸为 {requestedWidth} ×{" "}
      {requestedHeight} px。原图已保留，未缩放或裁剪。
    </p>
  );
}
