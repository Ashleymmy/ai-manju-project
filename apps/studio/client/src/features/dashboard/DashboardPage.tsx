import {
  ArrowUpRight,
  ChevronRight,
  Megaphone,
  Plus,
} from "lucide-react";
import { useLocation } from "wouter";

import { useProjectSummaries } from "@/entities/project";
import { useAuth } from "@/contexts/AuthContext";
import { ProjectCoverPickerDialog } from "@/components/ProjectCoverPickerDialog";
import { ChatComposer } from "@/features/chat";
import {
  formatCredits,
  formatDateTime,
  taskTypeLabel,
  useMemberConsumptionsQuery,
  useMemberOverviewQuery,
  type ConsumptionItem,
} from "@/features/member";
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
import "./styles.css";

/** 积分消耗面板展示的最近消耗条数（与积分明细页共用第 1 页缓存，渲染层再截断）。 */
const CONSUMPTION_PANEL_ROWS = 5;

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

/** 单条消耗的积分文案：已扣费显示实扣（负向），冻结中显示冻结额，失败/取消未扣费。 */
function consumptionCreditsLabel(item: ConsumptionItem) {
  if (item.charge_state === "charged") {
    return `-${formatCredits(item.credits_settled ?? item.credits_quoted)}`;
  }
  if (item.status === "reserved") {
    return `冻结 ${formatCredits(item.credits_quoted)}`;
  }
  return "未扣费";
}

/**
 * 积分消耗面板：本月消耗总览（overview.monthly_usage）+ 最近消耗记录，
 * 数据来自 GET /api/member/overview 与 /api/member/consumptions，非静态 UI。
 */
function CreditConsumptionPanel() {
  const [, navigate] = useLocation();
  const overviewQuery = useMemberOverviewQuery();
  const consumptionsQuery = useMemberConsumptionsQuery("", 1);
  const overview = overviewQuery.data;
  const monthly = overview?.monthly_usage;
  const available =
    (overview?.limited_available ?? 0) + (overview?.permanent_available ?? 0);
  const items = (consumptionsQuery.data?.items ?? []).slice(
    0,
    CONSUMPTION_PANEL_ROWS
  );

  return (
    <aside className="credit-panel">
      <div className="section-line">
        <span className="eyebrow">积分消耗</span>
        <button onClick={() => navigate("/member/usage")}>
          积分明细 <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="credit-summary">
        <div>
          <span>本月已消耗</span>
          <strong>
            {overview ? formatCredits(monthly?.total_credits) : "—"}
          </strong>
          <small>
            {overview
              ? `图片 ${formatCredits(monthly?.image_count)} 张 · 视频 ${formatCredits(monthly?.video_seconds)} 秒`
              : overviewQuery.isError
                ? "总览加载失败"
                : "正在读取总览…"}
          </small>
        </div>
        <div>
          <span>剩余可用</span>
          <strong>{overview ? formatCredits(available) : "—"}</strong>
          <small>
            {overview
              ? `限时 ${formatCredits(overview.limited_available)} · 永久 ${formatCredits(overview.permanent_available)}`
              : "限时 + 永久积分"}
          </small>
        </div>
      </div>
      <div className="credit-list">
        {consumptionsQuery.isPending ? (
          <p className="credit-state">正在读取消耗记录…</p>
        ) : consumptionsQuery.isError ? (
          <p className="credit-state">消耗记录加载失败，请稍后重试</p>
        ) : items.length === 0 ? (
          <p className="credit-state">
            暂无消耗记录，生成任务成功后会在这里留下扣费记录
          </p>
        ) : (
          items.map(item => (
            <div className="credit-row" key={item.id}>
              <div className="credit-row-main">
                <b>{taskTypeLabel(item.task_type)}</b>
                <span>
                  {item.model || "—"} · {formatDateTime(item.created_at)}
                </span>
              </div>
              <span
                className={`credit-row-num ${
                  item.charge_state === "charged" ? "is-charged" : ""
                }`}
              >
                {consumptionCreditsLabel(item)}
              </span>
            </div>
          ))
        )}
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
      <div className="dashboard-project-actions">
        <button
          className="outline-button"
          onClick={() => navigate("/projects")}
        >
          打开项目归档 <ArrowUpRight size={16} />
        </button>
      </div>
      <div className="desk-layout">
        <AdSlot />
        <StatStrip data={data} />
        <CreditConsumptionPanel />
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
