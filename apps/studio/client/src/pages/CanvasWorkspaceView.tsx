import { useLocation } from "wouter";

import { CanvasProvider } from "@/features/canvas/ui/CanvasProvider";
import CanvasWorkspaceViewContent from "@/features/canvas/CanvasWorkspaceContent";
import { scopeFromCanvasLocation } from "@/features/canvas/adapters/workspaceLocation";

/** 路由页面只负责解析 URL、创建独立画布实例并组合内容。 */
export default function CanvasWorkspaceView() {
  const [location] = useLocation();
  return (
    <CanvasProvider initialState={{ session: { scope: scopeFromCanvasLocation(location) } }}>
      <CanvasWorkspaceViewContent />
    </CanvasProvider>
  );
}
