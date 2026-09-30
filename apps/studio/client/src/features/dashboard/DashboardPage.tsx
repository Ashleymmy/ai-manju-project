import {
  ArrowUpRight,
  ChevronRight,
  Coins,
  Image as ImageIcon,
  Megaphone,
  Plus,
  Sparkles,
  Video,
} from "lucide-react";
import { useLocation } from "wouter";

import { useProjectSummaries } from "@/entities/project";
import { useAuth } from "@/contexts/AuthContext";
import { ProjectCoverPickerDialog } from "@/components/ProjectCoverPickerDialog";
import { ChatComposer } from "@/features/chat";
import { formatCredits, useMemberOverviewQuery } from "@/features/member";
import {
  createAndOpenProject,
  ProjectCard,
  ProjectCardTools,
  ProjectListFeedback,
  projectToCard,
  useProjectActions,
  useProjectCoverUrls,
} from "@/features/projects";

import {
  useWorkspaceDashboardData,
  type WorkspaceData,
} from "./useWorkspaceDashboardData";
import { CreationBudgetPopover } from "./CreationBudgetPopover";
import "./styles.css";

function StatStrip({ data }: { data?: WorkspaceData }) {
  const jobCount = data?.jobs.total;
  const assetCount = data?.assets.total;
  const projectCount = data?.projects.total;
  const comicCount = data?.comicProjects.total;
  return (
    <section className="stat-strip" aria-label="工作区概览">
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

/**
 * 广告位（预留）：当前没有广告投放，占位保持版式与尺寸；
 * 后续接入广告素材时只改这个组件内部，外层 desk-layout 不用动。
 */
function AdSlot() {
  return (
    <section className="ad-slot" aria-label="广告位预留">
      <span className="ad-slot-tag">AD</span>
      <div className="ad-slot-copy">
        <Megaphone size={22} strokeWidth={1.6} />
        <b>广告位预留</b>
        <p>品牌合作与活动推广将在这里展示，敬请期待</p>
      </div>
    </section>
  );
}

/**
 * 工作台强调本月创作成果，积分支出仍可在明细页查询。
 * 图片张数使用成功任务的实际产出，不能拿计费任务次数代替。
 */
function CreationOverviewPanel() {
  const [, navigate] = useLocation();
  const overviewQuery = useMemberOverviewQuery();
  const overview = overviewQuery.data;
  const monthly = overview?.monthly_usage;
  const imageCount = overview?.monthly_creation?.image_count;
  const available =
    (overview?.limited_available ?? 0) + (overview?.permanent_available ?? 0);
  const loadFailed = !overview && overviewQuery.isError;

  return (
    <aside className="credit-panel" aria-label="本月创作概览">
      <div className="creation-overview-head">
        <h3><Sparkles className="creation-overview-emblem" size={16} strokeWidth={1.7} aria-hidden="true" /> 本月创作</h3>
        <button className="creation-overview-link" onClick={() => navigate("/assets")}>
          查看作品 <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="creation-overview-note" aria-live="polite">
        <p>
          {monthly
            ? "让每个灵感，都有自己的画面。"
            : loadFailed
              ? "创作数据暂时未能加载"
              : overview
                ? "本月创作数据暂未同步"
                : "正在读取创作数据…"}
        </p>
        {loadFailed && (
          <button className="creation-overview-link" onClick={() => void overviewQuery.refetch()}>
            重新加载
          </button>
        )}
      </div>
      <div className="creation-stats">
        <button className="creation-stat creation-stat-image" onClick={() => navigate("/image")} aria-label="打开图片生成" title={imageCount == null ? "图片张数暂未同步" : "本月成功生成的图片张数"}>
          <span className="creation-stat-label"><ImageIcon size={16} aria-hidden="true" /> 图片生成</span>
          <span className="creation-stat-value">
            <strong>{imageCount != null ? formatCredits(imageCount) : "—"}</strong>
            <small>张</small>
          </span>
          <ArrowUpRight className="creation-stat-arrow" size={15} aria-hidden="true" />
        </button>
        <button className="creation-stat creation-stat-video" onClick={() => navigate("/video")} aria-label="打开视频生成">
          <span className="creation-stat-label"><Video size={16} aria-hidden="true" /> 视频生成</span>
          <span className="creation-stat-value">
            <strong>{monthly ? formatCredits(monthly.video_seconds) : "—"}</strong>
            <small>秒</small>
          </span>
          <ArrowUpRight className="creation-stat-arrow" size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="creation-overview-footer">
        <span className="creation-available">
          <Coins className="creation-balance-emblem" size={14} strokeWidth={1.7} aria-hidden="true" />
          <span>可用积分</span>
          <strong>{overview ? formatCredits(available) : "—"}</strong>
        </span>
        <div className="creation-overview-actions">
          <CreationBudgetPopover available={overview && !overviewQuery.isError ? available : undefined} />
          <button className="creation-overview-link" onClick={() => navigate("/member/usage")}>
            积分明细 <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}

export default function DashboardPage() {
  const [, navigate] = useLocation();
  const { data, refresh: refreshWorkspace } = useWorkspaceDashboardData();
  const { user } = useAuth();
  const { projects: recentProjects, loading: projectsLoading, error: projectsError, refreshing, refresh: refreshProjects } = useProjectSummaries("personal", user?.id || "");
  const { coverProject, setCoverProject, renameProject, saveCover, deleteProjects, duplicateProjects, copyingIds } =
    useProjectActions("personal", () => {
      void refreshWorkspace();
    });

  const recentCoverUrls = useProjectCoverUrls(recentProjects, "personal");
  const recentCards = recentProjects.slice(0, 3).map(projectToCard);

  return (
    <div className="page-content dashboard-page">
      {/* 创作对话框（原聊天台主页核心交互，现嵌在工作台顶部） */}
      <ChatComposer />
      <div className="desk-layout">
        <AdSlot />
        <StatStrip data={data} />
        <CreationOverviewPanel />
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
      <ProjectListFeedback error={projectsError} refreshing={refreshing} hasProjects={Boolean(recentProjects.length)} onRetry={() => { void refreshProjects(); }} />
      <div className="project-row">
        {recentCards.length ? (
          recentCards.map((project, index) => (
            <div className="project-card-wrap" key={project.id}>
              <ProjectCardTools
                onCover={() => setCoverProject(recentProjects[index])}
                onRename={() => void renameProject(recentProjects[index])}
                onCopy={() => project.id && void duplicateProjects([project.id])}
                copying={Boolean(project.id && copyingIds.includes(project.id))}
                copyDisabled={Boolean(copyingIds.length)}
                onDelete={() => project.id && void deleteProjects([project.id])}
              />
              <ProjectCard
                {...project}
                image={(project.id && recentCoverUrls[project.id]) || project.image}
              />
            </div>
          ))
        ) : projectsLoading ? <p role="status">正在读取项目…</p> : !projectsError ? (
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
        ) : null}
      </div>
      <ProjectCoverPickerDialog
        open={Boolean(coverProject)}
        scope="personal"
        currentCoverAssetId={coverProject?.cover_asset_id}
        onClose={() => setCoverProject(null)}
        onSelect={assetId => void saveCover(assetId)}
      />
    </div>
  );
}
