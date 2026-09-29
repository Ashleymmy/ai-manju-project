import { useState } from "react";
import { RefreshCcw, Search } from "lucide-react";

import { formatCents, formatCredits } from "@/features/member";

import type { DashboardController } from "../controllers/useDashboardController";
import type { AdminDashboard } from "../model/memberAdmin";
import { AdminQueryState } from "./components/adminBits";
import { DashboardDetails } from "./DashboardDetails";
import "./report-content.css";

// These filters select existing dashboard metrics; they do not imply that the
// platform-wide aggregate endpoint supports per-user or arbitrary-date reports.
const DASHBOARD_METRICS: {
  key: keyof AdminDashboard;
  label: string;
  category: string;
  period: string;
  note: string;
  money?: boolean;
}[] = [
  {
    key: "total_users",
    label: "总注册用户",
    category: "users",
    period: "all",
    note: "平台注册用户总量",
  },
  {
    key: "paid_users",
    label: "付费用户",
    category: "users",
    period: "all",
    note: "累计付费用户",
  },
  {
    key: "gmv_today_cents",
    label: "今日 GMV",
    category: "revenue",
    period: "today",
    note: "今日已支付订单金额",
    money: true,
  },
  {
    key: "gmv_month_cents",
    label: "本月 GMV",
    category: "revenue",
    period: "month",
    note: "本月已支付订单金额",
    money: true,
  },
  {
    key: "credits_consumed_today",
    label: "今日消耗积分",
    category: "generation",
    period: "today",
    note: "今日已消耗积分",
  },
  {
    key: "image_generation_total",
    label: "图片生成总数",
    category: "generation",
    period: "all",
    note: "累计生成图片 · 张",
  },
  {
    key: "video_seconds_total",
    label: "视频生成总秒数",
    category: "generation",
    period: "all",
    note: "累计生成视频 · 秒",
  },
];

/** 模块6 运营看板面板：7 项核心指标卡（金额 formatCents）。 */
export function DashboardPanel({
  controller,
}: {
  controller: DashboardController;
}) {
  const { dashboard, isError, isPending, reload } = controller;
  const [category, setCategory] = useState("");
  const [period, setPeriod] = useState("");
  const [keyword, setKeyword] = useState("");
  const [search, setSearch] = useState("");
  const metrics = DASHBOARD_METRICS.filter(
    metric =>
      (!category || metric.category === category) &&
      (!period || metric.period === period) &&
      (!search ||
        `${metric.label} ${metric.note}`
          .toLowerCase()
          .includes(search.toLowerCase()))
  );

  return (
    <section className="real-admin-section">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">BILLING / DASHBOARD</p>
          <h2>运营看板</h2>
          <small>
            注册、付费、GMV 与生成消耗的实时汇总（GMV 按已支付订单计）。
          </small>
        </div>
        <button className="outline-button small" onClick={() => void reload()}>
          <RefreshCcw size={14} /> 刷新
        </button>
      </div>

      <div className="admin-report-content">
        <form
          className="admin-report-filters"
          aria-label="运营指标筛选"
          onSubmit={event => {
            event.preventDefault();
            setSearch(keyword.trim());
          }}
        >
          <label>
            指标分类
            <select
              value={category}
              onChange={event => setCategory(event.target.value)}
            >
              <option value="">全部指标</option>
              <option value="users">用户</option>
              <option value="revenue">收入</option>
              <option value="generation">生成与消耗</option>
            </select>
          </label>
          <label>
            统计口径
            <select
              value={period}
              onChange={event => setPeriod(event.target.value)}
            >
              <option value="">全部口径</option>
              <option value="all">累计指标</option>
              <option value="today">今日指标</option>
              <option value="month">本月指标</option>
            </select>
          </label>
          <label>
            关键词
            <input
              value={keyword}
              onChange={event => setKeyword(event.target.value)}
              placeholder="搜索指标名称"
            />
          </label>
          <div className="admin-report-filter-actions">
            <button className="admin-report-button" type="submit">
              <Search size={16} /> 查询
            </button>
          </div>
        </form>
        <div className="admin-report-listhead">
          <h3>核心指标</h3>
          <span>
            显示 {metrics.length} / {DASHBOARD_METRICS.length} 项
          </span>
        </div>
        <AdminQueryState
          isPending={isPending}
          isError={isError}
          isEmpty={!dashboard || metrics.length === 0}
          emptyText={dashboard ? "没有符合筛选条件的指标" : "暂无看板数据"}
          onRetry={() => void reload()}
        >
          <div className="admin-report-stats">
            {metrics.map(metric => (
              <div key={metric.key}>
                <span>{metric.label}</span>
                <strong>
                  {metric.money
                    ? formatCents(dashboard?.[metric.key] ?? 0)
                    : formatCredits(dashboard?.[metric.key] ?? 0)}
                </strong>
                <small>{metric.note}</small>
              </div>
            ))}
          </div>
        </AdminQueryState>
        <DashboardDetails controller={controller.details} />
      </div>
    </section>
  );
}
