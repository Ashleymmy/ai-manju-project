import { useEffect, useMemo } from "react";
import DirectorDeskView from "./ui/DirectorDeskView";
import { resolveDirectorRoute } from "./model/navigation";

import "./styles.css";

export default function DirectorPage() {
  const route = useMemo(() => resolveDirectorRoute(
    window.location.search,
    window.location.origin,
    () => crypto.randomUUID(),
  ), []);

  useEffect(() => {
    if (!route.hasCanvasTarget) window.location.replace(route.directorSrc);
  }, [route]);

  // 暂时隐藏导航入口的嵌入小界面。保留画布节点的帧回写入口，方便后续恢复。
  if (route.hasCanvasTarget) return <DirectorDeskView />;
  return <div role="status" className="feature-page">正在打开 3D 导演台…</div>;
}
