import {
  ArrowUpRight,
  ChevronRight,
  MousePointer2,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";

import { getJobs, type Job } from "@/entities/job";
import { getProjects, type CanvasProject } from "@/entities/project";
import {
  createAndOpenProject,
  ProjectCard,
  projectToCard,
  useProjectCoverUrls,
} from "@/features/projects";
import { PageIntro } from "@/shared/ui";

import {
  useWorkspaceDashboardData,
  type WorkspaceData,
} from "./useWorkspaceDashboardData";
import "./styles.css";

const dashboardIntro = {
  code: "DESK / 01",
  title: "今日片场",
  subtitle: "在同一张工作桌上收拢灵感、镜头和等待落地的任务。",
};

function StatStrip({ data }: { data?: WorkspaceData }) {
  const jobCount = data?.jobs.total;
  const assetCount = data?.assets.total;
  const projectCount = data?.projects.total;
  const comicCount = data?.comicProjects.total;
  return (
    <section className="stat-strip">
      <div>
        <span>进行中任务</span>
        <strong>
          {jobCount != null ? String(jobCount).padStart(2, "0") : "—"}
        </strong>
        <small>图像与批量生成</small>
      </div>
      <div>
        <span>漫剧项目</span>
        <strong>
          {comicCount != null ? String(comicCount).padStart(2, "0") : "—"}
        </strong>
        <small>剧本与批量资产</small>
      </div>
      <div>
        <span>可调用资产</span>
        <strong>{assetCount ?? "—"}</strong>
        <small>来自真实资产库</small>
      </div>
      <div>
        <span>画布项目</span>
        <strong>
          {projectCount != null
            ? String(projectCount).padStart(2, "0")
            : "—"}
        </strong>
        <small>服务端快照</small>
      </div>
    </section>
  );
}

function LiveTimeline() {
  const [items, setItems] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    void getJobs({ limit: 4 })
      .then(result =>
        setItems(Array.isArray(result) ? result : result.items || [])
      )
      .catch(() => setItems([]))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="timeline-card">
      <div className="section-line">
        <span className="eyebrow">现场切片</span>
        <button onClick={() => window.location.assign("/queue")}>
          查看队列 <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="timeline-flow">
        <div className="timeline-time">
          <b>
            {new Date().toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </b>
          <span>现在</span>
        </div>
        {!loaded && (
          <div className="timeline-entry active">
            <i />
            <div>
              <b>正在读取任务队列</b>
              <span>GET /api/jobs</span>
            </div>
            <span className="status-chip blue">SYNC</span>
          </div>
        )}
        {loaded && !items.length && (
          <div className="timeline-entry">
            <i />
            <div>
              <b>暂无活跃任务</b>
              <span>生成任务提交后会同步到这里</span>
            </div>
            <span className="status-chip">空闲</span>
          </div>
        )}
        {items.map(job => (
          <div
            className={`timeline-entry ${
              job.status === "running" ? "active" : ""
            }`}
            key={job.id}
          >
            <i />
            <div>
              <b>{job.name || job.type}</b>
              <span>
                {job.type} · {job.id.slice(-8)}
              </span>
            </div>
            <span
              className={`status-chip ${
                job.status === "running"
                  ? "blue"
                  : job.status === "failed"
                    ? "sand"
                    : ""
              }`}
            >
              {job.status === "running"
                ? `${job.progress || 0}%`
                : job.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [, navigate] = useLocation();
  const { data } = useWorkspaceDashboardData();
  const [recentProjects, setRecentProjects] = useState<CanvasProject[]>([]);

  useEffect(() => {
    getProjects("personal")
      .then(result =>
        setRecentProjects(Array.isArray(result) ? result : result.items || [])
      )
      .catch(() => setRecentProjects([]));
  }, []);

  const recentCoverUrls = useProjectCoverUrls(recentProjects, "personal");
  const recentCards = recentProjects.slice(0, 3).map(projectToCard);
  const latestProject = recentProjects[0];
  const openLatest = () =>
    latestProject
      ? navigate(`/canvas/${encodeURIComponent(latestProject.id)}`)
      : void createAndOpenProject(navigate);

  return (
    <div className="page-content dashboard-page">
      <PageIntro
        copy={dashboardIntro}
        action={
          <button
            className="outline-button"
            onClick={() => navigate("/projects")}
          >
            打开项目归档 <ArrowUpRight size={16} />
          </button>
        }
      />
      <StatStrip data={data} />
      <div className="desk-layout">
        <section className="spotlight-card">
          <div className="spotlight-overlay" />
          <div className="spotlight-copy">
            <p className="eyebrow light">CONTINUE MAKING</p>
            <h2>
              把这一格推向
              <br />
              下一镜。
            </h2>
            <p>
              {latestProject
                ? `“${latestProject.title}”正在等待继续编辑。`
                : "创建第一张画布，开始新的镜头。"}
            </p>
            <button className="vermilion-button" onClick={openLatest}>
              <MousePointer2 size={16} /> {latestProject ? "回到无限画布" : "新建画布"}
            </button>
          </div>
          <div className="spotlight-meta">
            <span>
              {latestProject
                ? `PRJ-${latestProject.id.slice(-4).toUpperCase()}`
                : "NEW PROJECT"}
            </span>
            <span>
              {latestProject
                ? `最近保存 ${new Date(
                    latestProject.updated_at
                  ).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : "尚无项目"}
            </span>
          </div>
        </section>
        <LiveTimeline />
      </div>
      <section className="section-head">
        <div>
          <p className="eyebrow">RECENT SURFACES</p>
          <h2>最近展开的工作面</h2>
        </div>
        <button className="text-button" onClick={() => navigate("/projects")}>
          全部项目 <ChevronRight size={16} />
        </button>
      </section>
      <div className="project-row">
        {recentCards.length ? (
          recentCards.map(project => (
            <ProjectCard key={project.id} {...project} image={(project.id && recentCoverUrls[project.id]) || project.image} />
          ))
        ) : (
          <button
            className="project-card"
            onClick={() => void createAndOpenProject(navigate)}
          >
            <div className="project-info">
              <div>
                <h3>创建第一张画布</h3>
                <p>项目会真实保存到当前个人工作区</p>
              </div>
              <Plus size={18} />
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
