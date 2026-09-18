import { Sparkles } from "lucide-react";
import { useLocation } from "wouter";

import MetaBallOrb from "./MetaBallOrb";

/**
 * 全站右下角的 Agent 小球：复用画布内 canvas-agent-fab 的 MetaBallOrb 悬浮球。
 * 画布页自带同款小球（开关 Agent 面板）；其余界面点击小球跳到画布工坊，
 * 在那里继续与画布 Agent 协作。
 */
export default function StudioAgentFab() {
  const [, navigate] = useLocation();
  return (
    <button
      type="button"
      className="studio-agent-fab"
      title="打开画布 Agent"
      aria-label="打开画布 Agent"
      onClick={() => navigate("/canvas")}
    >
      <MetaBallOrb className="studio-agent-fab-orb" />
      <Sparkles size={20} />
    </button>
  );
}
