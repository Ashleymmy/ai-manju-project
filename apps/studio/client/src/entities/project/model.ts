import type { WorkspaceScope } from "@/shared/config";

export type CanvasProject = {
  id: string;
  title: string;
  owner_id?: string;
  workspace_id?: string;
  scope?: WorkspaceScope;
  data?: unknown;
  /** 用户自定义封面资产 ID；为空时卡片回退到默认抽象封面 */
  cover_asset_id?: string;
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

/** Listing metadata is never a source for editable canvas snapshots. */
export type CanvasProjectSummary = Omit<CanvasProject, "data">;

export function projectSummary({ data: _data, ...summary }: CanvasProject): CanvasProjectSummary {
  return summary;
}
