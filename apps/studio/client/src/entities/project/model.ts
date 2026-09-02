import type { WorkspaceScope } from "@/shared/config";

export type CanvasProject = {
  id: string;
  title: string;
  owner_id?: string;
  workspace_id?: string;
  scope?: WorkspaceScope;
  data?: unknown;
  created_at: string;
  updated_at: string;
};

export type CanvasSnapshotResponse = {
  project_id: string;
  version: number;
  data: unknown;
  created_at: string;
  updated_at: string;
};
