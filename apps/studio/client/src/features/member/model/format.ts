import { CREDITS_PER_YUAN_FALLBACK, DISCOUNT_BPS_FULL } from "./constants";

/**
 * 会员中心格式化工具。金额一律 cents → ¥xx.xx；积分千分位；时间本地化。
 */

/** 后端金额单位为 cents，前端统一转换为 ¥xx.xx 文案。 */
export function formatCents(cents: number | null | undefined) {
  const value = Number(cents);
  if (!Number.isFinite(value)) return "¥0.00";
  return `¥${(value / 100).toFixed(2)}`;
}

/** 积分千分位展示（12,400）。 */
export function formatCredits(credits: number | null | undefined) {
  const value = Number(credits);
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString("zh-CN");
}

/** RFC3339 → 本地日期时间（2026.07.01 12:00）。 */
export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** RFC3339 → 本地日期（2026.07.01）。 */
export function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

/** 距到期剩余天数（向上取整，负数归 0）。 */
export function daysUntil(value?: string | null, now: Date = new Date()) {
  if (!value) return 0;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return 0;
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 86_400_000));
}

/**
 * 有效积分单价（积分/元）动态文案：随活动/会员折扣实时计算，
 * 禁止写死「约 100 积分/元」（设计修复项 #8）。
 */
export function effectiveCreditsPerYuan(creditsPerYuan: number, discountBps: number) {
  const rate = Number(creditsPerYuan) > 0 ? Number(creditsPerYuan) : CREDITS_PER_YUAN_FALLBACK;
  const bps = Number(discountBps);
  if (!Number.isFinite(bps) || bps <= 0 || bps >= DISCOUNT_BPS_FULL) return rate;
  return Math.round((rate * DISCOUNT_BPS_FULL) / bps);
}

/** 基点折扣 → 文案（8000 → "8 折"；10000 → "无折扣"）。 */
export function discountLabel(discountBps: number) {
  const bps = Number(discountBps);
  if (!Number.isFinite(bps) || bps <= 0 || bps >= DISCOUNT_BPS_FULL) return "无折扣";
  const zhe = bps / 1_000;
  return `${Number.isInteger(zhe) ? zhe : zhe.toFixed(1)} 折`;
}

/** 打折后应付金额（cents，整分截断，与后端 `*bps/10000` 口径一致）。 */
export function discountedCents(priceCents: number, discountBps: number) {
  const bps = Number(discountBps);
  if (!Number.isFinite(bps) || bps <= 0 || bps >= DISCOUNT_BPS_FULL) return Math.round(priceCents);
  return Math.floor((Math.round(priceCents) * bps) / DISCOUNT_BPS_FULL);
}

/** 倒计时差值 → {天,时,分,秒}。 */
export function countdownParts(endsAt: string | undefined, nowMs: number) {
  const end = endsAt ? new Date(endsAt).getTime() : NaN;
  if (!Number.isFinite(end) || end <= nowMs) return null;
  let remain = Math.floor((end - nowMs) / 1_000);
  const days = Math.floor(remain / 86_400);
  remain -= days * 86_400;
  const hours = Math.floor(remain / 3_600);
  remain -= hours * 3_600;
  const minutes = Math.floor(remain / 60);
  const seconds = remain - minutes * 60;
  return { days, hours, minutes, seconds };
}

/** 活动是否在生效窗口内。 */
export function activityActive(activity: { enabled?: boolean; starts_at?: string; ends_at?: string } | undefined, nowMs: number) {
  if (!activity?.enabled) return false;
  const start = activity.starts_at ? new Date(activity.starts_at).getTime() : NaN;
  const end = activity.ends_at ? new Date(activity.ends_at).getTime() : NaN;
  if (Number.isFinite(start) && nowMs < start) return false;
  if (Number.isFinite(end) && nowMs > end) return false;
  return true;
}
