import type { CanvasNodeData } from "./types";
import { isRecord, stringValue } from "./value";

/** 超过此时长的本地/服务端任务不再自动接回，避免误绑旧任务。 */
export const CANVAS_PENDING_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type RecoverableCanvasJob = {
  id: string;
  payload?: unknown;
  created_at?: string;
  updated_at?: string;
  status?: string;
};

export type CanvasJobAssignment = {
  nodeId: string;
  jobId: string;
};

export function canvasJobSourceNodeId(job: RecoverableCanvasJob) {
  const payload = isRecord(job.payload) ? job.payload : {};
  const registration = isRecord(payload.asset_registration)
    ? payload.asset_registration
    : {};
  return stringValue(registration.source_node_id);
}

export function canvasJobSourceProjectId(job: RecoverableCanvasJob) {
  const payload = isRecord(job.payload) ? job.payload : {};
  const registration = isRecord(payload.asset_registration)
    ? payload.asset_registration
    : {};
  return stringValue(registration.source_project_id);
}

export function isFreshCanvasJob(
  job: RecoverableCanvasJob,
  now = Date.now(),
  maxAgeMs = CANVAS_PENDING_JOB_MAX_AGE_MS,
) {
  const stamp = Date.parse(job.updated_at || job.created_at || "");
  if (!Number.isFinite(stamp)) return true;
  return now - stamp <= maxAgeMs;
}

export function applyPendingCanvasJobIds(
  nodes: CanvasNodeData[],
  assignments: readonly CanvasJobAssignment[],
) {
  if (!assignments.length) return nodes;
  const byNode = new Map(
    assignments.map(item => [item.nodeId, item.jobId] as const),
  );
  let changed = false;
  const next = nodes.map(node => {
    const jobId = byNode.get(node.id);
    if (!jobId || node.metadata?.status !== "loading") return node;
    if (stringValue(node.metadata?.jobId) === jobId) return node;
    changed = true;
    return {
      ...node,
      metadata: {
        ...node.metadata,
        jobId,
        errorDetails: undefined,
      },
    };
  });
  return changed ? next : nodes;
}

export function matchLoadingNodesToJobs(
  nodes: readonly CanvasNodeData[],
  jobs: readonly RecoverableCanvasJob[],
  projectId: string,
) {
  const loading = nodes.filter(
    node =>
      (node.kind === "image" || node.kind === "video")
      && node.metadata?.status === "loading"
      && !stringValue(node.metadata?.jobId),
  );
  const projectJobs = jobs.filter(job => {
    if (!job.id || !isFreshCanvasJob(job)) return false;
    const sourceProjectId = canvasJobSourceProjectId(job);
    return !sourceProjectId || sourceProjectId === projectId;
  });
  const used = new Set<string>();
  const matches: CanvasJobAssignment[] = [];

  const take = (nodeId: string, job: RecoverableCanvasJob | undefined) => {
    if (!job || used.has(job.id)) return;
    used.add(job.id);
    matches.push({ nodeId, jobId: job.id });
  };

  loading.forEach(node => {
    take(
      node.id,
      projectJobs.find(job => canvasJobSourceNodeId(job) === node.id),
    );
  });

  loading.forEach(node => {
    if (matches.some(item => item.nodeId === node.id)) return;
    const originId = stringValue(node.metadata?.sourceNodeId);
    if (!originId) return;
    const candidates = projectJobs.filter(
      job => !used.has(job.id) && canvasJobSourceNodeId(job) === originId,
    );
    if (candidates.length === 1) take(node.id, candidates[0]);
  });

  loading.forEach(node => {
    if (matches.some(item => item.nodeId === node.id)) return;
    const originId = stringValue(node.metadata?.sourceNodeId);
    take(
      node.id,
      projectJobs.find(job => {
        if (used.has(job.id)) return false;
        const sourceNodeId = canvasJobSourceNodeId(job);
        return sourceNodeId === node.id || (originId !== "" && sourceNodeId === originId);
      }),
    );
  });

  return matches;
}

export function markUnrecoverableCanvasGenerations(
  nodes: CanvasNodeData[],
  targetIds?: ReadonlySet<string>,
) {
  const recoverableIds = new Set(
    nodes
      .filter(
        node =>
          node.metadata?.status === "loading" && stringValue(node.metadata?.jobId),
      )
      .map(node => node.id),
  );
  let changed = false;
  const next = nodes.map(node => {
    if (targetIds && !targetIds.has(node.id)) return node;
    if (node.metadata?.status !== "loading" || stringValue(node.metadata?.jobId)) {
      return node;
    }
    if (node.kind !== "image" && node.kind !== "video") return node;
    const batchChildren = Array.isArray(node.metadata?.batchChildIds)
      ? node.metadata.batchChildIds.filter((id): id is string => typeof id === "string")
      : [];
    if (node.metadata?.isBatchRoot && batchChildren.some(id => recoverableIds.has(id))) {
      return node;
    }
    changed = true;
    return {
      ...node,
      title: node.metadata?.isBatchRoot ? "批量生成已中断" : "生成已中断",
      metadata: {
        ...node.metadata,
        status: "error" as const,
        errorDetails: "未找到进行中的生成任务，请重新生成。",
      },
    };
  });
  return changed ? next : nodes;
}
