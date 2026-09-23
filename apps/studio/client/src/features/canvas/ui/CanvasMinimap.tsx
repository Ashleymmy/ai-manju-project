import { useEffect, useRef, useState, type PointerEvent } from "react";
import { canvasMinimapViewportInFrame, canvasMinimapWorldPoint, type CanvasMinimapModel } from "../domain/minimap";

type Point = { x: number; y: number };
// Allow small hand jitter while preserving click-to-center behavior.
const MINIMAP_DRAG_THRESHOLD = 3;
type MinimapDrag = { pointerId: number; model: CanvasMinimapModel; offset: Point; start: Point; moved: boolean };

export function CanvasMinimap({ model, selectedNodeIds, onNavigate }: {
  model: CanvasMinimapModel;
  selectedNodeIds: ReadonlySet<string>;
  onNavigate: (world: Point) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<MinimapDrag | null>(null);
  const [drag, setDrag] = useState<MinimapDrag | null>(null);
  const frame = drag?.model || model;
  const viewport = drag ? canvasMinimapViewportInFrame(model, frame) : model.viewport;

  const finish = () => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (current && svgRef.current?.hasPointerCapture(current.pointerId)) svgRef.current.releasePointerCapture(current.pointerId);
  };
  useEffect(() => {
    const svg = svgRef.current;
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("blur", finish);
      const current = dragRef.current;
      dragRef.current = null;
      if (current && svg?.hasPointerCapture(current.pointerId)) svg.releasePointerCapture(current.pointerId);
    };
  }, []);

  const pointFromEvent = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return null;
    // Screen CTM includes the SVG viewBox, borders and the mobile CSS scale.
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (!current.moved) {
      if (Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) < MINIMAP_DRAG_THRESHOLD) return;
      current.moved = true;
    }
    const point = pointFromEvent(event);
    if (point) onNavigate(canvasMinimapWorldPoint(current.model, { x: point.x - current.offset.x, y: point.y - current.offset.y }));
  };

  return (
    <div className={`canvas-minimap${drag ? " is-dragging" : ""}`} data-canvas-ui data-canvas-no-zoom
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
      <div><span>MINIMAP</span><b>{model.nodes.length} NODES</b></div>
      <svg ref={svgRef} viewBox={`0 0 ${frame.width} ${frame.height}`} role="img"
        aria-label="画布缩略导航，点击或拖动可移动当前视口"
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary || dragRef.current) return;
          const point = pointFromEvent(event);
          if (!point) return;
          event.preventDefault();
          event.stopPropagation();
          const inside = point.x >= model.viewport.x && point.x <= model.viewport.x + model.viewport.width
            && point.y >= model.viewport.y && point.y <= model.viewport.y + model.viewport.height;
          const current = { pointerId: event.pointerId, model, start: { x: event.clientX, y: event.clientY }, moved: false, offset: inside
            ? { x: point.x - model.viewport.x - model.viewport.width / 2, y: point.y - model.viewport.y - model.viewport.height / 2 }
            : { x: 0, y: 0 } };
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = current;
          setDrag(current);
          if (!inside) onNavigate(canvasMinimapWorldPoint(model, point));
        }}
        onPointerMove={move}
        onPointerUp={event => {
          const current = dragRef.current;
          if (current?.pointerId !== event.pointerId) return;
          move(event);
          const point = pointFromEvent(event);
          if (!current.moved && point) onNavigate(canvasMinimapWorldPoint(current.model, point));
          finish();
        }}
        onPointerCancel={event => { if (dragRef.current?.pointerId === event.pointerId) finish(); }}
        onLostPointerCapture={event => { if (dragRef.current?.pointerId === event.pointerId) finish(); }}>
        {frame.nodes.map(node => <rect key={node.id} className={selectedNodeIds.has(node.id) ? "selected" : ""}
          x={node.x} y={node.y} width={node.width} height={node.height} rx={1.5} />)}
        <rect className="viewport" x={viewport.x} y={viewport.y} width={viewport.width} height={viewport.height} />
      </svg>
    </div>
  );
}
