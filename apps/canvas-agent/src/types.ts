import type {
    CanvasAgentConnection,
    CanvasAgentNode,
    CanvasAgentNodeType,
    CanvasAgentPosition,
    CanvasAgentSnapshot,
    CanvasAgentViewport,
} from "@ai-manju/canvas-agent-protocol";

export type Position = CanvasAgentPosition;
export type Viewport = CanvasAgentViewport;
export type CanvasNodeType = CanvasAgentNodeType;
export type CanvasNode = CanvasAgentNode;
export type CanvasConnection = CanvasAgentConnection;
// The local bridge accepts partial snapshots while a browser is reconnecting;
// the full browser snapshot still follows the shared protocol shape.
export type CanvasSnapshot = Partial<CanvasAgentSnapshot<CanvasNode, CanvasConnection, Viewport>>;
export type AgentEmit = (type: string, payload: unknown) => void;
export type AgentAttachment = { name?: string; type?: string; dataUrl?: string };
