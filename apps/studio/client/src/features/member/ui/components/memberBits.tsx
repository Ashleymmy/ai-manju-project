import { AlertTriangle, Loader2, Timer } from "lucide-react";
import type { ReactNode } from "react";

import type { ActivityConfig } from "../../model/types";
import { activityActive, countdownParts, discountLabel } from "../../model/format";

/** 状态胶囊（TapNow 口径：成功绿 / 失败红 / 取消或待处理灰）。 */
export function StatusPill({ tone, children }: { tone: "green" | "red" | "gray" | "blue"; children: ReactNode }) {
  return <span className={`member-pill ${tone}`}>{children}</span>;
}

export function LoadingBlock({ text = "正在加载…" }: { text?: string }) {
  return (
    <div className="member-state">
      <Loader2 className="spin" size={22} />
      <p>{text}</p>
    </div>
  );
}

export function EmptyBlock({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="member-state">
      <p>{text}</p>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

export function ErrorBlock({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="member-state">
      <AlertTriangle size={22} />
      <p>数据加载失败</p>
      {onRetry ? (
        <button type="button" className="outline-button small" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}

/** 限时活动倒计时横幅（activity 配置驱动；未开启或已结束不渲染）。 */
export function CountdownBanner({ activity, nowMs }: { activity?: ActivityConfig; nowMs: number }) {
  if (!activityActive(activity, nowMs)) return null;
  const parts = countdownParts(activity?.ends_at, nowMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="member-activity-banner">
      <Timer size={16} />
      <b>限时特惠</b>
      {activity?.discount_bps ? <span>消耗低至 {discountLabel(activity.discount_bps)}</span> : null}
      {parts ? (
        <span className="member-countdown" aria-label="活动倒计时">
          <i>{pad(parts.days)}</i>天<i>{pad(parts.hours)}</i>时<i>{pad(parts.minutes)}</i>分<i>{pad(parts.seconds)}</i>秒
        </span>
      ) : null}
    </div>
  );
}
