import { ChevronLeft, ChevronRight, RefreshCcw } from "lucide-react";

import {
  CONSUMPTION_STATUS_OPTIONS,
  CREDIT_KIND_OPTIONS,
  LEDGER_TYPE_OPTIONS,
  TASK_TYPE_OPTIONS,
  TIME_RANGE_OPTIONS,
} from "../model/constants";
import { formatCredits, formatDateTime, taskTypeLabel } from "../model/format";
import type { ConsumptionItem, LedgerEntry } from "../model/types";
import type { UsageController } from "../controllers/useUsageController";
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusPill } from "./components/memberBits";

const LEDGER_TYPE_LABELS: Record<string, string> = {
  recharge: "充值购买",
  member_monthly: "会员月发",
  consume: "任务消耗",
  admin_add: "后台调增",
  admin_subtract: "后台调减",
  expire: "过期扣减",
  activity_bonus: "活动赠送",
  refund_rollback: "退款回滚",
};

function ledgerTypeLabel(value: string) {
  return LEDGER_TYPE_LABELS[value] || value || "—";
}

function taskTitle(item: ConsumptionItem) {
  // 任务名(模型)：模型为主，附关键参数摘要。
  const params = item.params || {};
  const bits: string[] = [];
  if (typeof params.resolution === "string" && params.resolution) bits.push(params.resolution.toUpperCase());
  if (typeof params.duration_sec === "number") bits.push(`${params.duration_sec} 秒`);
  if (typeof params.count === "number" && params.count > 1) bits.push(`×${params.count}`);
  return { model: item.model || "—", summary: bits.join(" / ") };
}

function ConsumptionRow({ item }: { item: ConsumptionItem }) {
  const charged = item.charge_state === "charged";
  const reserved = item.status === "reserved";
  const title = taskTitle(item);
  return (
    <div className="member-table-row member-usage-row">
      <span>{formatDateTime(item.created_at)}</span>
      <span>{taskTypeLabel(item.task_type)}</span>
      <span className="member-cell-main">
        <b>{title.model}</b>
        {title.summary ? <small>{title.summary}</small> : null}
      </span>
      <span className="member-cell-num">
        {charged ? formatCredits(item.credits_settled ?? item.credits_quoted) : reserved ? `${formatCredits(item.credits_quoted)}（冻结）` : "0"}
      </span>
      <span>{item.limited_credits > 0 ? `限时 ${formatCredits(item.limited_credits)}` : "—"}</span>
      <span>{item.permanent_credits > 0 ? `永久 ${formatCredits(item.permanent_credits)}` : "—"}</span>
      <span>
        {charged ? (
          <StatusPill tone="green">已扣费</StatusPill>
        ) : (
          <StatusPill tone="gray">{reserved ? "冻结中" : "未扣费"}</StatusPill>
        )}
      </span>
    </div>
  );
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const positive = entry.amount >= 0;
  return (
    <div className="member-table-row member-ledger-row">
      <span>{formatDateTime(entry.created_at)}</span>
      <span>{ledgerTypeLabel(entry.entry_type)}</span>
      <span className={`member-cell-num ${positive ? "is-positive" : "is-negative"}`}>
        {positive ? "+" : ""}{formatCredits(entry.amount)}
      </span>
      <span>{entry.bucket === "grant" ? "限时积分" : "永久积分"}</span>
      <span className="member-cell-num">{formatCredits(entry.permanent_after)}</span>
    </div>
  );
}

/** 消耗明细页（/member/usage）：消耗明细 + 积分流水 双 tab，筛选 + 分页。 */
export function UsageDetailView({ controller }: { controller: UsageController }) {
  return (
    <div className="member-stack">
      <div className="member-section-head">
        <div className="segmented">
          <button
            type="button"
            className={controller.boardTab === "consumptions" ? "selected" : ""}
            onClick={() => controller.changeBoardTab("consumptions")}
          >
            消耗明细
          </button>
          <button
            type="button"
            className={controller.boardTab === "ledger" ? "selected" : ""}
            onClick={() => controller.changeBoardTab("ledger")}
          >
            积分流水
          </button>
        </div>
        <button type="button" className="outline-button small" onClick={controller.reload}>
          <RefreshCcw size={13} /> 刷新
        </button>
      </div>

      {/* 筛选区 */}
      <div className="member-filters">
        {controller.boardTab === "consumptions" ? (
          <>
            <select value={controller.taskType} onChange={event => controller.setTaskType(event.target.value)} aria-label="任务类型">
              {TASK_TYPE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select value={controller.creditKind} onChange={event => controller.setCreditKind(event.target.value)} aria-label="积分类型">
              {CREDIT_KIND_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select value={controller.status} onChange={event => controller.applyStatus(event.target.value)} aria-label="任务状态">
              {CONSUMPTION_STATUS_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select value={controller.timeRangeDays} onChange={event => controller.setTimeRangeDays(Number(event.target.value))} aria-label="时间范围">
              {TIME_RANGE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </>
        ) : (
          <select value={controller.ledgerType} onChange={event => controller.applyLedgerType(event.target.value)} aria-label="流水类型">
            {LEDGER_TYPE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        )}
      </div>

      {controller.isPending ? <LoadingBlock text="正在读取明细…" /> : null}
      {controller.isError ? <ErrorBlock onRetry={controller.reload} /> : null}

      {!controller.isPending && !controller.isError && controller.boardTab === "consumptions" ? (
        controller.consumptions.length === 0 ? (
          <EmptyBlock text="暂无消耗记录" hint="生成任务成功后才会在这里留下扣费记录" />
        ) : (
          <div className="member-table">
            <div className="member-table-head member-usage-row">
              <span>时间</span>
              <span>任务类型</span>
              <span>任务（模型）</span>
              <span>消耗积分</span>
              <span>限时积分</span>
              <span>永久积分</span>
              <span>状态</span>
            </div>
            {controller.consumptions.map(item => (
              <ConsumptionRow key={item.id} item={item} />
            ))}
          </div>
        )
      ) : null}

      {!controller.isPending && !controller.isError && controller.boardTab === "ledger" ? (
        controller.ledgerEntries.length === 0 ? (
          <EmptyBlock text="暂无流水记录" />
        ) : (
          <div className="member-table">
            <div className="member-table-head member-ledger-row">
              <span>时间</span>
              <span>流水类型</span>
              <span>变动积分</span>
              <span>积分账户</span>
              <span>变动后永久余额</span>
            </div>
            {controller.ledgerEntries.map(entry => (
              <LedgerRow key={entry.id} entry={entry} />
            ))}
          </div>
        )
      ) : null}

      {/* 分页 */}
      <div className="member-pagination">
        <span>共 {formatCredits(controller.total)} 条 · 第 {controller.page} / {controller.totalPages} 页</span>
        <div>
          <button
            type="button"
            className="outline-button small"
            disabled={controller.page <= 1}
            onClick={() => controller.setPage(controller.page - 1)}
          >
            <ChevronLeft size={13} /> 上一页
          </button>
          <button
            type="button"
            className="outline-button small"
            disabled={controller.page >= controller.totalPages}
            onClick={() => controller.setPage(controller.page + 1)}
          >
            下一页 <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
