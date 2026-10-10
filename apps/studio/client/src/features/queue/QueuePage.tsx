import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Film,
  MoreHorizontal,
  Pause,
  RadioTower,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import { listComicBatches, listComicProjects } from "@/entities/comic";
import {
  cancelJob,
  getJobs,
  type Job,
  type JobState,
} from "@/entities/job";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";
import { PageIntro } from "@/shared/ui";

import "./styles.css";

type QueueJobRow = {
  id: string;
  name: string;
  type: string;
  state: JobState;
  scope: string;
  progress: number;
  updated: string;
  kind: "job" | "comic";
};

const comicBatchStateMap: Record<string, JobState> = {
  queued: "queued",
  running: "running",
  paused: "queued",
  stopping: "running",
  succeeded: "succeeded",
  partial_failed: "failed",
  canceled: "canceled",
};

const queueIntro = {
  code: "RENDER / LIVE",
  title: "渲染队列",
  subtitle: "所有图像、视频与批量生成任务在这一处显示即时状态。",
};

/** Polling interval for generation jobs. */
const JOB_REFRESH_MS = 3_000;
/** Comic batches are aggregated across several projects, so they are polled less often. */
const COMIC_REFRESH_MS = 10_000;
/** Jobs per list page; keeps the page height bounded no matter how many jobs exist. */
const QUEUE_PAGE_SIZE = 20;

const queueStateLabel: Record<JobState, string> = {
  running: "生成中",
  queued: "队列中",
  succeeded: "已完成",
  canceled: "已取消",
  failed: "异常",
};

/** Status cards above the list; canceled jobs only appear in the distribution bar. */
const queueFlowSteps: Array<{ state: JobState; label: string; hint: string }> = [
  { state: "queued", label: "等待 / 暂停", hint: "已提交，排队等待生成资源" },
  { state: "running", label: "执行中", hint: "正在生成，进度实时更新" },
  { state: "succeeded", label: "已完成", hint: "生成结束，结果可直接使用" },
  { state: "failed", label: "异常 / 失败", hint: "生成未成功，可调整后重新提交" },
];

const queueDistributionOrder: Array<{ state: JobState; label: string }> = [
  { state: "running", label: "执行中" },
  { state: "queued", label: "等待" },
  { state: "succeeded", label: "已完成" },
  { state: "failed", label: "异常" },
  { state: "canceled", label: "已取消" },
];

function formatSyncTime(date: Date) {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function QueuePage() {
  const [, navigate] = useLocation();
  const [scope, setScope] = useState<WorkspaceScope>("personal");
  const [filter, setFilter] = useState<JobState | "all">("all");
  const [page, setPage] = useState(1);
  const [apiJobs, setApiJobs] = useState<QueueJobRow[] | null>(null);
  const [comicRows, setComicRows] = useState<QueueJobRow[]>([]);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);

  const refresh = useCallback(() => {
    void getJobs({ limit: 50, scope })
      .then(res => {
        const raw: Job[] = Array.isArray(res) ? res : res.items;
        setSyncedAt(new Date());
        setSyncFailed(false);
        setApiJobs(
          raw.map(job => ({
            id: job.id,
            name: job.name ?? job.type,
            type: job.type
              .toUpperCase()
              .replace(/\./g, " / ")
              .replace(/_/g, " "),
            state: job.status,
            scope: job.scope ?? scope,
            progress: job.progress ?? 0,
            updated: job.updated_at
              ? new Date(job.updated_at).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—",
            kind: "job" as const,
          }))
        );
      })
      .catch(() => {
        setApiJobs(current => current ?? []);
        setSyncFailed(true);
      });
  }, [scope]);

  const refreshComicBatches = useCallback(() => {
    void listComicProjects(scope)
      .then(async projects => {
        const batchLists = await Promise.allSettled(
          projects.slice(0, 12).map(async project => {
            const batches = await listComicBatches(project.id, scope);
            return batches.map(batch => ({ project, batch }));
          })
        );
        const rows = batchLists
          .flatMap(result =>
            result.status === "fulfilled" ? result.value : []
          )
          .sort(
            (left, right) =>
              new Date(
                right.batch.updated_at || right.batch.created_at
              ).getTime() -
              new Date(left.batch.updated_at || left.batch.created_at).getTime()
          )
          .slice(0, 20)
          .map(({ project, batch }): QueueJobRow => ({
            id: batch.id,
            name: `${project.title} · 漫剧批量`,
            type: "COMIC / BATCH",
            state: comicBatchStateMap[batch.status] || "queued",
            scope,
            progress: batch.total
              ? Math.round(
                  ((batch.succeeded + batch.failed + batch.canceled) /
                    batch.total) *
                    100
                )
              : 0,
            updated: batch.updated_at
              ? new Date(batch.updated_at).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—",
            kind: "comic",
          }));
        setComicRows(rows);
      })
      .catch(() => setComicRows([]));
  }, [scope]);

  useEffect(() => {
    setApiJobs(null);
    setComicRows([]);
    setSyncedAt(null);
    setSyncFailed(false);
    setPage(1);
    refresh();
    refreshComicBatches();
    const timer = window.setInterval(refresh, JOB_REFRESH_MS);
    const comicTimer = window.setInterval(refreshComicBatches, COMIC_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(comicTimer);
    };
  }, [refresh, refreshComicBatches]);

  const displayJobs = [...(apiJobs ?? []), ...comicRows];
  const visible = displayJobs.filter(
    job => filter === "all" || job.state === filter
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / QUEUE_PAGE_SIZE));
  // Polling can shrink the page count; show the last page instead of an empty one.
  const currentPage = Math.min(page, pageCount);
  const pageJobs = visible.slice((currentPage - 1) * QUEUE_PAGE_SIZE, currentPage * QUEUE_PAGE_SIZE);
  const applyFilter = (next: JobState | "all") => { setFilter(next); setPage(1); };
  const count = (state: JobState) =>
    displayJobs.filter(job => job.state === state).length;
  const tabs: Array<[JobState | "all", string]> = [
    ["all", `全部 ${String(displayJobs.length).padStart(2, "0")}`],
    ["running", `执行中 ${String(count("running")).padStart(2, "0")}`],
    ["queued", `等待 ${String(count("queued")).padStart(2, "0")}`],
    ["succeeded", `完成 ${String(count("succeeded")).padStart(2, "0")}`],
    ["failed", `异常 ${String(count("failed")).padStart(2, "0")}`],
  ];
  const succeededCount = count("succeeded");
  const finishedCount =
    succeededCount + count("failed") + count("canceled");
  const successRate = finishedCount
    ? Math.round((succeededCount / finishedCount) * 100)
    : null;
  const distribution = queueDistributionOrder
    .map(item => ({ ...item, value: count(item.state) }))
    .filter(item => item.value > 0);
  const syncLabel = syncFailed
    ? "同步失败，自动重试中"
    : syncedAt
      ? `已同步 ${formatSyncTime(syncedAt)}`
      : "同步中…";

  return (
    <div className="page-content">
      <PageIntro
        copy={queueIntro}
        action={
          <div className="queue-actions">
            <div className="scope-switch">
              {/* 暂时隐藏"团队空间"切换（全局隐藏），恢复时删除下方 filter 调用 */}
              {(["personal", "team"] as const).filter((item) => item !== "team").map(item => (
                <button
                  key={item}
                  className={scope === item ? "active" : ""}
                  onClick={() => setScope(item)}
                >
                  {item === "personal" ? "个人空间" : "团队空间"}
                </button>
              ))}
            </div>
            <div className="queue-nav-buttons">
              <button
                className="queue-nav-button"
                onClick={() => navigate("/image")}
              >
                图片生成
              </button>
              <button
                className="queue-nav-button"
                onClick={() => navigate("/video")}
              >
                视频生成
              </button>
              <button
                className="queue-nav-button active"
                onClick={() => navigate("/canvas")}
              >
                回到画布
              </button>
            </div>
          </div>
        }
      />

      <div className="queue-overview" aria-label="任务状态概览">
        {queueFlowSteps.map(step => {
          const value = count(step.state);
          const active = filter === step.state;
          return (
            <button
              type="button"
              key={step.state}
              className={`queue-stat ${step.state}${value ? " has-jobs" : ""}${active ? " active" : ""}`}
              aria-pressed={active}
              title={active ? "再次点击显示全部任务" : `只看${step.label}`}
              onClick={() => applyFilter(active ? "all" : step.state)}
            >
              <span className="queue-stat-label"><i aria-hidden="true" />{step.label}</span>
              <b>{String(value).padStart(2, "0")}</b>
              <small>{step.hint}</small>
            </button>
          );
        })}
        <div className="queue-stat queue-stat-rate">
          <span className="queue-stat-label">
            成功率
            <span className={`queue-live${syncFailed ? " failed" : ""}`} role="status">
              <i aria-hidden="true" />
              {syncLabel}
            </span>
          </span>
          <b>{successRate === null ? "—" : `${successRate}%`}</b>
          <div
            className="queue-rate-bar"
            role="img"
            aria-label={
              distribution.length
                ? distribution.map(item => `${item.label} ${item.value}`).join("，")
                : "暂无任务"
            }
          >
            {distribution.map(item => (
              <i
                className={item.state}
                key={item.state}
                style={{ flexGrow: item.value }}
                title={`${item.label} ${item.value}`}
              />
            ))}
          </div>
          <small>
            {finishedCount
              ? `已结束 ${finishedCount} 个任务，成功 ${succeededCount} 个`
              : "暂无已结束的任务"}
          </small>
        </div>
      </div>

      <section className="queue-card">
          <div className="queue-tabs">
            {tabs.map(([key, label]) => (
              <button
                className={filter === key ? "active" : ""}
                key={key}
                onClick={() => applyFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {visible.length > 0 && (
            <div className="queue-row queue-row-head" aria-hidden="true">
              <span />
              <span>任务</span>
              <span>类型</span>
              <span>任务 ID</span>
              <span>状态</span>
              <span>更新</span>
              <span />
            </div>
          )}
          <div className="job-list">
            {pageJobs.map(job => (
              <div className="queue-row" key={`${job.kind}-${job.id}`}>
                <div className={`job-icon ${job.state}`}>
                  {job.kind === "comic" ? (
                    <Clapperboard size={18} />
                  ) : (
                    <Film size={18} />
                  )}
                </div>
                <div className="queue-row-name">
                  <b title={job.name}>{job.name}</b>
                  {(job.state === "running" || job.state === "queued") && (
                    <div className="job-progress">
                      <i style={{ width: `${job.progress}%` }} />
                    </div>
                  )}
                </div>
                <span className="queue-row-type">{job.type}</span>
                <code className="queue-row-id" title={job.id}>{job.id}</code>
                <span className="queue-row-state">
                  <span className={`status-chip ${job.state}`}>{queueStateLabel[job.state]}</span>
                </span>
                <time className="queue-row-time">{job.updated}</time>
                {job.kind === "comic" ? (
                  <button
                    className="icon-button subtle"
                    title="打开资产助手"
                    onClick={() => navigate("/comic-assets")}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                ) : job.state === "running" || job.state === "queued" ? (
                  <button
                    className="icon-button subtle"
                    title="取消任务"
                    onClick={() =>
                      void cancelQueueJob(job.id, job.scope, refresh)
                    }
                  >
                    <Pause size={16} />
                  </button>
                ) : (
                  <button className="icon-button subtle" disabled>
                    <MoreHorizontal size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!visible.length && (
            <div className="empty-output">
              <RadioTower size={27} />
              <p>当前筛选没有任务。</p>
            </div>
          )}
          <footer className="queue-pager">
            <p>
              任务每 {JOB_REFRESH_MS / 1000} 秒刷新，漫剧批量每{" "}
              {COMIC_REFRESH_MS / 1000} 秒同步
            </p>
            {visible.length > QUEUE_PAGE_SIZE && (
              <nav aria-label="任务分页">
                <span>
                  {(currentPage - 1) * QUEUE_PAGE_SIZE + 1}–{Math.min(currentPage * QUEUE_PAGE_SIZE, visible.length)} / 共 {visible.length} 个
                </span>
                <button type="button" aria-label="上一页" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                  <ChevronLeft size={15} />
                </button>
                <b>{currentPage} / {pageCount}</b>
                <button type="button" aria-label="下一页" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>
                  <ChevronRight size={15} />
                </button>
              </nav>
            )}
          </footer>
      </section>
    </div>
  );
}

async function cancelQueueJob(
  id: string,
  scope: string,
  refresh: () => void
) {
  try {
    await cancelJob(id, scope as WorkspaceScope);
    toast.success("任务已取消");
    refresh();
  } catch (error) {
    toast.error(publicApiError(error, "取消任务失败"));
  }
}
