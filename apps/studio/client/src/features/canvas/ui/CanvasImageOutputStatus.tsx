import type { CanvasNodeData } from "../domain/types";
import { canvasImageGenerationError } from "../domain/imageGenerationError";

/** A successful output whose size differs from the request is kept as-is without an inspector notice. */
export function CanvasImageOutputStatus({ node }: { node: CanvasNodeData }) {
  if (node.kind !== "image") return null;
  if (node.metadata?.status !== "error" || !node.metadata.errorDetails) return null;
  return (
    <p role="alert" className="px-3 py-2 text-xs text-red-300">
      {canvasImageGenerationError(node.metadata.errorDetails)}
    </p>
  );
}
