import { useMemo } from "react";
import { ArrowRight, Box, CircleDashed, FolderKanban, Image, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import StudioShell from "@/components/StudioShell";
import { API_BASE_URL } from "@/services/api";
import { useWorkspaceDashboardData } from "@/hooks/useWorkspaceDashboardData";
import { useLocation } from "wouter";

const cards = [
  { key: "projects", label: "画布项目", detail: "项目与快照", icon: FolderKanban, href: "/projects" },
  { key: "comicProjects", label: "漫剧项目", detail: "角色 · 场景 · 批次", icon: Sparkles, href: "/comic-assets" },
  { key: "jobs", label: "进行中任务", detail: "图像 · 视频 · 导出", icon: CircleDashed, href: "/queue" },
  { key: "assets", label: "媒体资产", detail: "资产库与血缘", icon: Image, href: "/assets" },
] as const;

function MetricValue({ value, state }: { value?: number; state: string }) { return <strong className={state === "error" ? "metric-error" : ""}>{state === "loading" ? "···" : state === "error" ? "—" : value ?? "—"}</strong>; }

export default function Dashboard() {
  const { data, loading, refresh } = useWorkspaceDashboardData();
  const [, setLocation] = useLocation();
  const failures = useMemo(() => Object.values(data).filter((metric) => metric.state === "error").length, [data]);
  return <StudioShell eyebrow="CREATIVE LAB / PERSONAL" title="工作台">
    <main className="workbench-page">
      <section className={`api-status-panel ${failures ? "is-offline" : ""}`}><div className="api-status-icon"><ShieldCheck size={20} /></div><div><p>WORKSPACE SIGNAL</p><h2>{loading ? "正在同步创作工作区…" : failures ? "创作数据源等待连接" : "工作区已连接，随时开始创作"}</h2><span>{failures ? "服务地址未连接时，不会以样例数据替代你的真实项目。" : "项目、资产与任务状态正在保持同步。"}</span></div><button className="compact-action" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />刷新工作区</button></section>

      <section className="metrics-grid">{cards.map(({ key, label, detail, icon: Icon, href }) => { const metric = data[key]; return <button className="metric-card" onClick={() => setLocation(href)} key={key}><span className="metric-icon"><Icon size={19} /></span><div><p>{label}</p><MetricValue value={metric.total} state={metric.state} /><small>{detail}</small></div><ArrowRight size={16} /></button>; })}</section>

      <section className="dashboard-grid">
        <article className="architecture-card"><div className="section-kicker"><Box size={16} />创作流</div><h2>从灵感画布到可追溯的漫剧资产。</h2><p>在一个连续工作面中整理项目、关键帧、素材、图层和特效。每一次生成都会进入队列，并在完成后归档回你的资产库。</p><div className="contract-flow"><span>画布</span><i /> <span>关键帧 / 特效</span><i /> <span>资产库</span><i /> <span>导出</span></div></article>
        <article className="endpoint-card"><div className="section-kicker"><CircleDashed size={16} />工作区脉冲</div><ul>{cards.map((card) => <li key={card.key}><span className={`state-dot ${data[card.key].state}`} /><div><b>{card.label}</b><code>{card.detail}</code></div><small>{data[card.key].state === "ready" ? "已同步" : data[card.key].state === "loading" ? "同步中" : "待连接"}</small></li>)}</ul><details className="diagnostics"><summary>连接诊断</summary><code>Base URL · {API_BASE_URL}<br />Bearer Token · X-Request-Id</code></details></article>
      </section>

      <section className="module-strip"><div><p>核心工作流</p><h2>从项目、画布、生成任务到统一资产归档。</h2></div><div className="module-links"><button onClick={() => setLocation("/canvas")}>打开画布工坊 <ArrowRight size={15} /></button><button onClick={() => setLocation("/queue")}>查看任务队列 <ArrowRight size={15} /></button></div></section>
    </main>
  </StudioShell>;
}
