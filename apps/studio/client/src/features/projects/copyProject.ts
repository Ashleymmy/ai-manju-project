import { createProject, getProject, getProjectSummaries, getProjectSnapshot } from "@/entities/project";
import { ApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";

// Runtime jobs belong to the original project; a copy retains graph content only.
const RUNTIME_METADATA_KEYS = ["jobId", "jobProgress", "taskId", "taskProgress"] as const;
const RUNNING_STATUSES = new Set(["loading", "running", "pending", "queued", "processing"]);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

export function copyProjectSnapshot(value: unknown, createId = () => crypto.randomUUID()) {
  if (!record(value) || (value.nodes !== undefined && !Array.isArray(value.nodes))) {
    throw new Error("原画布数据无效，未创建副本");
  }
  const copy = structuredClone(value);
  // Node/edge/group IDs are project-local. Keeping them preserves every internal @ reference.
  for (const node of (copy.nodes || []) as unknown[]) {
    if (!record(node) || !record(node.metadata)) continue;
    const metadata = node.metadata;
    // Text saved from a copied canvas must not update the original canvas' local asset.
    delete metadata.textAssetId;
    delete metadata.textAssetScope;
    RUNTIME_METADATA_KEYS.forEach(key => delete metadata[key]);
    if (RUNNING_STATUSES.has(String(metadata.status))) metadata.status = "idle";
    if (RUNNING_STATUSES.has(String(metadata.batchStatus))) metadata.batchStatus = "idle";
    if (typeof metadata.directorInstanceId === "string") {
      metadata.directorInstanceId = createId();
      delete metadata.directorProjectFingerprint;
      metadata.directorRevision = 0;
      metadata.directorOutputKeys = [];
      metadata.directorOutputNodeIds = [];
    }
  }
  delete copy.projectId;
  delete copy.project_id;
  return copy;
}

export function projectCopyTitle(title: string, titles: ReadonlySet<string>) {
  const base = `${title}（副本）`;
  let candidate = base;
  for (let index = 2; titles.has(candidate); index += 1) candidate = `${base} ${index}`;
  return candidate;
}

export async function copyProject(id: string, scope: WorkspaceScope) {
  const source = await getProject(id, scope);
  let data: unknown = source.data ?? { nodes: [], edges: [] };
  try {
    data = (await getProjectSnapshot(id, scope)).data;
  } catch (error) {
    // Old, untouched projects can lack a versioned snapshot. Network failures are not empty canvases.
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }
  const projects = await getProjectSummaries(scope);
  const title = projectCopyTitle(source.title, new Set(projects.map(project => project.title)));
  return createProject({ title, scope, data: copyProjectSnapshot(data), cover_asset_id: source.cover_asset_id });
}
