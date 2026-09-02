import {
  ArrowUpRight,
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

export default function QueuePage() {
  const [, navigate] = useLocation();
  const [scope, setScope] = useState<WorkspaceScope>("personal");
  const [filter, setFilter] = useState<JobState | "all">("all");
  const [apiJobs, setApiJobs] = useState<QueueJobRow[] | null>(null);
  const [comicRows, setComicRows] = useState<QueueJobRow[]>([]);

  const refresh = useCallback(() => {
    void getJobs({ limit: 50, scope })
      .then(res => {
        const raw: Job[] = Array.isArray(res) ? res : res.items;
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
      .catch(() => setApiJobs([]));
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
    refresh();
    refreshComicBatches();
    const timer = window.setInterval(refresh, 3_000);
    const comicTimer = window.setInterval(refreshComicBatches, 10_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(comicTimer);
    };
  }, [refresh, refreshComicBatches]);

  const displayJobs = [...(apiJobs ?? []), ...comicRows];
  const visible = displayJobs.filter(
    job => filter === "all" || job.state === filter
  );
  const count = (state: JobState) =>
    displayJobs.filter(job => job.state === state).length;
  const tabs: Array<[JobState | "all", string]> = [
    ["all", `全部 ${String(displayJobs.length).padStart(2, "0")}`],
    ["running", `执行中 ${String(count("running")).padStart(2, "0")}`],
    ["queued", `等待 ${String(count("queued")).padStart(2, "0")}`],
    ["succeeded", `完成 ${String(count("succeeded")).padStart(2, "0")}`],
    ["failed", `异常 ${String(count("failed")).padStart(2, "0")}`],
  ];

  return (
    <div className="page-content">
      <PageIntro
        copy={queueIntro}
        action={
          <div className="queue-actions">
            <div className="scope-switch">
              {(["personal", "team"] as const).map(item => (
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

      <div className="queue-status-overview">
        <div className="status-item">
          <span className="status-count">
            {String(count("running")).padStart(2, "0")}
          </span>
          <span className="status-text">运行中</span>
        </div>
        <div className="status-item">
          <span className="status-count">
            {String(count("queued")).padStart(2, "0")}
          </span>
          <span className="status-text">等待 / 暂停</span>
        </div>
        <div className="status-item">
          <span className="status-count">
            {String(count("succeeded")).padStart(2, "0")}
          </span>
          <span className="status-text">已完成</span>
        </div>
        <div className="status-item">
          <span className="status-count">
            {String(count("failed")).padStart(2, "0")}
          </span>
          <span className="status-text">异常 / 失败</span>
        </div>
      </div>

      <div className="queue-layout">
        <section className="queue-card">
          <div className="queue-tabs">
            {tabs.map(([key, label]) => (
              <button
                className={filter === key ? "active" : ""}
                key={key}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="job-list">
            {visible.map(job => (
              <div className="job-row" key={`${job.kind}-${job.id}`}>
                <div className={`job-icon ${job.state}`}>
                  {job.kind === "comic" ? (
                    <Clapperboard size={18} />
                  ) : (
                    <Film size={18} />
                  )}
                </div>
                <div className="job-copy">
                  <div>
                    <b>{job.name}</b>
                    <span>
                      {job.type} · {job.id}
                    </span>
                  </div>
                  {(job.state === "running" || job.state === "queued") && (
                    <div className="job-progress">
                      <i style={{ width: `${job.progress}%` }} />
                    </div>
                  )}
                </div>
                <div className="job-state">
                  <span className={`status-chip ${job.state}`}>
                    {job.state === "running"
                      ? "生成中"
                      : job.state === "queued"
                        ? "队列中"
                        : job.state === "succeeded"
                          ? "已完成"
                          : job.state === "canceled"
                            ? "已取消"
                            : "异常"}
                  </span>
                  <small>{job.updated}</small>
                </div>
                {job.kind === "comic" ? (
                  <button
                    className="icon-button subtle"
                    title="打开漫剧资产助手"
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
        </section>
        <aside className="queue-aside">
          <p className="eyebrow">STATUS MACHINE</p>
          <h3>
            让每次等待
            <br />
            都看得见。
          </h3>
          <div className="state-machine">
            <span className="done">queued</span>
            <i />
            <span className="active">running</span>
            <i />
            <span>succeeded</span>
          </div>
          <p>
            队列状态来自服务端 Job 与漫剧批次，随个人 / 团队空间切换；页面刷新后会重新读取，不依赖本地假数据。
          </p>
          <code>GET /api/jobs?limit=50&scope={scope}</code>
        </aside>
      </div>
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
