import type { CanvasNodeData } from "../domain/types";

/** Compare against the submitted request, never against settings edited afterwards. */
export function CanvasImageOutputStatus({ node }: { node: CanvasNodeData }) {
  if (node.kind !== "image") return null;
  if (node.metadata?.status === "error" && node.metadata.errorDetails) {
    return (
      <p role="alert" className="px-3 py-2 text-xs text-red-300">
        {node.metadata.errorDetails}
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
      生成服务返回了 {width} × {height} px，未达到本次要求的 {requestedWidth} ×{" "}
      {requestedHeight} px。 原图已保留，可更换模型或重新生成。
    </p>
  );
}
