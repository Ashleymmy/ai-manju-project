import { CANVAS_PENDING_JOB_MAX_AGE_MS } from "@/features/canvas/domain/generationResume";
import type { CanvasJobAssignment } from "@/features/canvas/domain/generationResume";

const STORAGE_KEY = "ai-manju.canvas-pending-jobs.v1";

export type StoredPendingCanvasJob = CanvasJobAssignment & {
  kind: "image" | "video";
  projectKey: string;
  savedAt: number;
};

function readAll(): StoredPendingCanvasJob[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((item): item is StoredPendingCanvasJob => {
      if (!item || typeof item !== "object") return false;
      const record = item as StoredPendingCanvasJob;
      return Boolean(
        record.nodeId
        && record.jobId
        && record.projectKey
        && (record.kind === "image" || record.kind === "video")
        && typeof record.savedAt === "number"
        && now - record.savedAt <= CANVAS_PENDING_JOB_MAX_AGE_MS,
      );
    });
  } catch {
    return [];
  }
}

function writeAll(items: StoredPendingCanvasJob[]) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // 隐私模式或配额满时忽略，刷新恢复走服务端任务列表。
  }
}

export function rememberPendingCanvasJob(job: StoredPendingCanvasJob) {
  if (!job.nodeId || !job.jobId || !job.projectKey) return;
  const next = readAll().filter(
    item => item.nodeId !== job.nodeId && item.jobId !== job.jobId,
  );
  next.push({ ...job, savedAt: job.savedAt || Date.now() });
  writeAll(next);
}

export function forgetPendingCanvasJob(nodeId: string, jobId?: string) {
  if (!nodeId && !jobId) return;
  writeAll(readAll().filter(item => {
    if (nodeId && item.nodeId === nodeId) return false;
    if (jobId && item.jobId === jobId) return false;
    return true;
  }));
}

export function pendingCanvasJobsForProject(projectKey: string): CanvasJobAssignment[] {
  if (!projectKey) return [];
  return readAll()
    .filter(item => item.projectKey === projectKey)
    .map(item => ({ nodeId: item.nodeId, jobId: item.jobId }));
}
