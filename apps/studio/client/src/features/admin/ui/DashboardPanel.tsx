import { RefreshCcw } from "lucide-react";

import { formatCents, formatCredits } from "@/features/member";

import type { DashboardController } from "../controllers/useDashboardController";
import { AdminQueryState } from "./components/adminBits";

/** 模块6 运营看板面板：7 项核心指标卡（金额 formatCents）。 */
export function DashboardPanel({ controller }: { controller: DashboardController }) {
  const { dashboard, isError, isPending, reload } = controller;

  return (
    <section className="real-admin-section">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">BILLING / DASHBOARD</p>
          <h2>运营看板</h2>
          <small>注册、付费、GMV 与生成消耗的实时汇总（GMV 按已支付订单计）。</small>
        </div>
        <button className="outline-button small" onClick={() => void reload()}>
          <RefreshCcw size={14} /> 刷新
        </button>
      </div>

      <AdminQueryState
        isPending={isPending}
        isError={isError}
        isEmpty={!dashboard}
        emptyText="暂无看板数据"
        onRetry={() => void reload()}
      >
        <div className="monitor-grid admin-stat-grid">
          <div>
            <span>总注册用户</span>
            <b>{formatCredits(dashboard?.total_users ?? 0)}</b>
            <em className="healthy">users</em>
          </div>
          <div>
            <span>付费用户</span>
            <b>{formatCredits(dashboard?.paid_users ?? 0)}</b>
            <em className="healthy">paying</em>
          </div>
          <div>
            <span>今日 GMV</span>
            <b>{formatCents(dashboard?.gmv_today_cents ?? 0)}</b>
            <em className="healthy">today</em>
          </div>
          <div>
            <span>本月 GMV</span>
            <b>{formatCents(dashboard?.gmv_month_cents ?? 0)}</b>
            <em className="healthy">month</em>
          </div>
          <div>
            <span>今日消耗积分</span>
            <b>{formatCredits(dashboard?.credits_consumed_today ?? 0)}</b>
            <em className="healthy">credits</em>
          </div>
          <div>
            <span>图片生成总数</span>
            <b>{formatCredits(dashboard?.image_generation_total ?? 0)}</b>
            <em className="healthy">images</em>
          </div>
          <div>
            <span>视频生成总秒数</span>
            <b>{formatCredits(dashboard?.video_seconds_total ?? 0)}</b>
            <em className="healthy">seconds</em>
          </div>
        </div>
      </AdminQueryState>
    </section>
  );
}
