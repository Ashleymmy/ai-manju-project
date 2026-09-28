import { useCallback, useEffect, useRef, useState } from "react";
import { cancelJob, jobErrorMessage, jobProgressNotice, type Job } from "@/entities/job";
import type { WorkspaceScope } from "@/shared/config";
import { ApiError } from "@/shared/api/http";
import { generateImages, generatedImagesFromJob, waitForImageJob, type GeneratedImage, type ImageGenerationInput } from "../api";

type ActiveTask = { key: string; scope: WorkspaceScope; controller: AbortController; jobId?: string; cancelling?: boolean };
type Callbacks = {
  onCompleted(images: GeneratedImage[]): void;
  onError(error: unknown): void;
  onStopped(): void;
};

function storageKey(ownerId: string, scope: WorkspaceScope) {
  return ownerId ? `ai-manju.image-pending-job.v1:${encodeURIComponent(ownerId)}:${scope}` : "";
}

function pendingJob(key: string) {
  if (!key) return "";
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

function remember(task: ActiveTask, id: string) {
  task.jobId = id;
  try { if (task.key && id) localStorage.setItem(task.key, id); } catch { /* Storage may be unavailable in private browsing. */ }
}

function forget(task: ActiveTask) {
  try { if (task.key && pendingJob(task.key) === task.jobId) localStorage.removeItem(task.key); } catch { /* Keep in-memory completion usable. */ }
}

async function readAcceptedTask(task: ActiveTask, onProgress: (job: Job) => void) {
  let job: Job;
  try {
    job = await waitForImageJob(task.jobId!, { signal: task.controller.signal, onProgress });
  } catch (error) {
    // Only an authoritative task lookup can prove the ID no longer exists.
    // A missing result asset, network interruption or throttling cannot do so.
    if (!task.controller.signal.aborted && error instanceof ApiError && error.status === 404) forget(task);
    throw error;
  }
  if (job.status !== "succeeded") throw new Error(jobErrorMessage(job, "图片生成失败"));
  return generatedImagesFromJob(job, task.scope, task.controller.signal);
}

/** Retain only durable task IDs, partitioned by account and workspace. */
export function useImageTaskSession(ownerId: string, scope: WorkspaceScope, callbacks: Callbacks) {
  const key = storageKey(ownerId, scope);
  const keyRef = useRef(key);
  keyRef.current = key;
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const activeRef = useRef<ActiveTask | null>(null);
  const [result, setResult] = useState<GeneratedImage[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobNotice, setJobNotice] = useState<string>();
  const [generating, setGenerating] = useState(false);
  const isCurrent = useCallback((task: ActiveTask) => activeRef.current === task && keyRef.current === task.key && !task.controller.signal.aborted, []);

  const execute = useCallback(async (task: ActiveTask, operation: (progress: (job: Job) => void) => Promise<GeneratedImage[]>) => {
    activeRef.current = task;
    setGenerating(true);
    setJobId(task.jobId || null);
    setJobProgress(0);
    setJobNotice(undefined);
    const progress = (job: Job) => {
      // Only server-confirmed failed/canceled tasks are terminal on an error path.
      if (job.status === "failed" || job.status === "canceled") forget(task);
      if (isCurrent(task)) {
        setJobId(job.id);
        setJobProgress(job.progress ?? 0);
        setJobNotice(jobProgressNotice(job));
      }
    };
    try {
      const images = await operation(progress);
      if (!isCurrent(task)) return;
      forget(task);
      setResult(images);
      setJobProgress(100);
      setJobNotice(undefined);
      callbacksRef.current.onCompleted(images);
    } catch (error) {
      // Unmounting/switching only detaches the client; the durable job remains.
      if (isCurrent(task)) {
        if (task.jobId && !pendingJob(task.key)) setJobId(null);
        callbacksRef.current.onError(error);
      }
    } finally {
      if (activeRef.current === task) {
        activeRef.current = null;
        if (keyRef.current === task.key) setGenerating(false);
      }
    }
  }, [isCurrent]);

  useEffect(() => {
    setResult([]);
    setJobId(null);
    setJobProgress(0);
    setJobNotice(undefined);
    setGenerating(false);
    const id = pendingJob(key);
    if (id) {
      const task = { key, scope, controller: new AbortController(), jobId: id };
      void execute(task, onProgress => readAcceptedTask(task, onProgress));
    }
    return () => {
      const task = activeRef.current;
      if (task?.key === key) { activeRef.current = null; task.controller.abort(); }
    };
  }, [key, scope, execute]);

  const generate = useCallback(async (input: ImageGenerationInput | ((signal: AbortSignal) => Promise<ImageGenerationInput>)) => {
    if (!key || activeRef.current) return;
    const task: ActiveTask = { key, scope, controller: new AbortController() };
    const acceptedId = pendingJob(key);
    if (acceptedId) {
      // Never replace an unresolved accepted job with another paid submission.
      task.jobId = acceptedId;
      await execute(task, onProgress => readAcceptedTask(task, onProgress));
      return;
    }
    setResult([]);
    await execute(task, async onProgress => {
      const payload = typeof input === "function" ? await input(task.controller.signal) : input;
      if (!isCurrent(task)) throw new DOMException("Aborted", "AbortError");
      const generated = await generateImages({ ...payload, scope }, {
        signal: task.controller.signal,
        onAccepted: job => {
          const id = job.job_id || job.id || "";
          remember(task, id);
          if (isCurrent(task)) setJobId(id || null);
        },
        onProgress,
      });
      return generated.images;
    });
  }, [key, scope, execute, isCurrent]);

  const stop = useCallback(async () => {
    const task = activeRef.current;
    if (!task || !isCurrent(task) || task.cancelling) return;
    if (task.jobId) {
      task.cancelling = true;
      try {
        const canceled = await cancelJob(task.jobId, task.scope);
        if (!isCurrent(task) || canceled.status !== "canceled") return;
      } catch (error) {
        if (isCurrent(task)) callbacksRef.current.onError(error);
        return;
      } finally {
        task.cancelling = false;
      }
      forget(task);
    }
    activeRef.current = null;
    task.controller.abort();
    setGenerating(false);
    callbacksRef.current.onStopped();
    setJobNotice(undefined);
  }, [isCurrent]);

  return { result, setResult, jobId, jobProgress, jobNotice, generating, generate, stop };
}
