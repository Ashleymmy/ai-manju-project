import { Image as ImageIcon, Plus } from "lucide-react";

import { incomingCanvasMediaSources } from "@/features/canvas/domain/connections";
import { imageSrcFromNode } from "@/features/canvas/domain/nodes";
import type { CanvasEdgeData, CanvasNodeData } from "@/features/canvas/domain/types";

type CanvasIncomingMediaStripProps = {
  nodeId: string;
  nodes: CanvasNodeData[];
  edges: CanvasEdgeData[];
  previews: Record<string, string>;
  onPreview: (nodeId: string) => void;
  onAdd: () => void;
};

export function CanvasIncomingMediaStrip({
  nodeId,
  nodes,
  edges,
  previews,
  onPreview,
  onAdd,
}: CanvasIncomingMediaStripProps) {
  const sources = incomingCanvasMediaSources(nodeId, nodes, edges);
  return (
    <div className="canvas-incoming-refs" data-count={sources.length}>
      {sources.map((source) => {
        const preview = imageSrcFromNode(source.node, previews);
        return (
          <button
            key={source.edgeId}
            type="button"
            className="canvas-incoming-ref-slot"
            title={source.node.title || "参考图"}
            onClick={() => onPreview(source.node.id)}
          >
            {preview ? <img src={preview} alt="" /> : <ImageIcon size={14} />}
          </button>
        );
      })}
      <button
        type="button"
        className="canvas-incoming-ref-slot canvas-incoming-ref-add"
        title="连接参考图"
        onClick={onAdd}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
