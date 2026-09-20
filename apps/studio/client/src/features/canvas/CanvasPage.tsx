import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getProjects, type CanvasProject } from "@/entities/project";
import CanvasWorkspaceView from "@/pages/CanvasWorkspaceView";
import { publicApiError } from "@/shared/api/errors";
import { canvasListHref, canvasProjectHref, projectScopeFromServer, scopeFromCanvasSearch } from "./domain/workspace";

import "./styles.css";

function projectEditedAt(project: CanvasProject) {
  return Date.parse(project.updated_at) || Date.parse(project.created_at) || 0;
}

function RecentCanvasRedirect() {
  const [, navigate] = useLocation();
  const scope = scopeFromCanvasSearch(useSearch());

  useEffect(() => {
    let cancelled = false;
    // Fetch on entry so edits on another device and deleted projects are reflected.
    void getProjects(scope).then(result => {
      if (cancelled) return;
      const projects = Array.isArray(result) ? result : result.items;
      const recent = [...projects].filter(project => project.id)
        .sort((left, right) => projectEditedAt(right) - projectEditedAt(left))[0];
      navigate(recent
        ? canvasProjectHref(recent.id, projectScopeFromServer(recent, scope))
        : canvasListHref(scope), { replace: true });
    }).catch(error => {
      if (cancelled) return;
      toast.error(publicApiError(error, "无法打开最近编辑的画布，请在列表中重试"));
      navigate(canvasListHref(scope), { replace: true });
    });
    return () => { cancelled = true; };
  }, [navigate, scope]);

  return (
    <div className="page-content canvas-workspace-full">
      <div className="empty-output" role="status">
        <Loader2 className="spin" size={20} aria-hidden="true" />
        <p>正在打开最近编辑的画布…</p>
      </div>
    </div>
  );
}

export default function CanvasPage() {
  const [location] = useLocation();
  const search = useSearch();
  if (location.split("?")[0] === "/canvas" && new URLSearchParams(search).get("resume") === "recent") {
    return <RecentCanvasRedirect />;
  }
  return <CanvasWorkspaceView />;
}
