import { useLocation } from "wouter";

import type { WorkspaceScope } from "@/shared/config";

import type { ProjectCardData } from "./model";

export function ProjectCard({
  id,
  title,
  code,
  chapter,
  image,
  state,
  color,
  time,
  scope,
}: ProjectCardData & { scope?: WorkspaceScope }) {
  const [, navigate] = useLocation();
  const href = id
    ? `/canvas/${encodeURIComponent(id)}${
        scope && scope !== "personal"
          ? `?scope=${encodeURIComponent(scope)}`
          : ""
      }`
    : "/projects";
  return (
    <button className="project-card" onClick={() => navigate(href)}>
      <div className="project-visual">
        {image ? (
          <img src={image} alt="" />
        ) : (
          <div className="abstract-canvas" aria-hidden="true">
            <span className="abstract-card one" />
            <span className="abstract-card two" />
          </div>
        )}
        <span className={`state-ribbon ${color}`}>{state}</span>
        <span className="project-code">{code}</span>
      </div>
      <div className="project-info">
        <div>
          <h3>{title}</h3>
          <p>{chapter}</p>
        </div>
        <span>{time}</span>
      </div>
    </button>
  );
}
