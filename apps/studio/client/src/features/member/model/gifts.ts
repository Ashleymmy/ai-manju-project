/**
 * 礼包超市（WP-M15）货架归一化与展示口径。
 * 数据源：GET /api/member/gifts → {items}（billing_configs["gift_packs"] 原样透传），
 * 配置是运营手工维护的 JSON，字段全部容错缺省；本期无下单接口（按钮禁用「即将上线」）。
 */

import { formatCredits } from "./format";
import type { GiftPack } from "./types";

/** 空态文案（任务约定口径）。 */
export const GIFT_EMPTY_TEXT = "礼包筹备中，敬请期待";

function numberOr(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

/** 单条货架项归一化：任意脏数据都落到安全默认。 */
export function normalizeGiftPack(raw: unknown, index: number): GiftPack {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    id: stringOr(record.id, "") || `gift-${index + 1}`,
    name: stringOr(record.name, "") || "未命名礼包",
    description: stringOr(record.description, ""),
    cover: stringOr(record.cover, ""),
    price_cents: Math.max(0, numberOr(record.price_cents, 0)),
    credits: Math.max(0, numberOr(record.credits, 0)),
    membership_days: Math.max(0, numberOr(record.membership_days, 0)),
    enabled: record.enabled !== false,
    sort_order: numberOr(record.sort_order, 0),
  };
}

/**
 * 货架归一化：接受 {items} 信封或裸数组，过滤下架项并按 sort_order 升序。
 * 未配置/非法数据一律返回空数组（页面渲染空态）。
 */
export function normalizeGiftPacks(raw: unknown): GiftPack[] {
  const container = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(raw) ? raw : Array.isArray(container.items) ? container.items : [];
  return list
    .map((item, index) => normalizeGiftPack(item, index))
    .filter(item => item.enabled)
    .sort((left, right) => left.sort_order - right.sort_order || left.price_cents - right.price_cents);
}

/** 内容量文案：优先积分，其次会员天数；都没有则占位。 */
export function giftContentLabel(pack: Pick<GiftPack, "credits" | "membership_days">) {
  if (pack.credits > 0) return `${formatCredits(pack.credits)} 积分`;
  if (pack.membership_days > 0) return `${pack.membership_days} 天会员`;
  return "内容待定";
}
