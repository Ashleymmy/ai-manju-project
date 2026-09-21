import type { PricingRulesConfig } from "./types";

/** 文档默认单价（与后端定价器常量一致；pricing_rules 配置缺失时兜底）。 */
export const IMAGE_PRICE_FALLBACK = { small_512: 20, standard_1024: 50, large: 80 } as const;
export const VIDEO_FAST_PER_SECOND_FALLBACK = 8;
export const VIDEO_STANDARD_PER_SECOND_FALLBACK = 12;

/** 图片按最大边分档取单价（与后端 imagePriceForSize 同口径：
 *  ≤512 → 普通档；≥2048 → 大图档；其余 → 1024 标准档）。 */
export function imagePriceForDimension(
  rules: PricingRulesConfig | undefined,
  maxDimension: number
): number {
  const small = rules?.image?.small_512 ?? IMAGE_PRICE_FALLBACK.small_512;
  const standard = rules?.image?.standard_1024 ?? IMAGE_PRICE_FALLBACK.standard_1024;
  const large = rules?.image?.large ?? IMAGE_PRICE_FALLBACK.large;
  if (maxDimension <= 512) return small;
  if (maxDimension >= 2048) return large;
  return standard;
}

/** 图片生成估算积分：单价 × 张数（仅为估算，活动折扣以后端结算为准）。 */
export function estimateImageCredits(
  rules: PricingRulesConfig | undefined,
  width: number,
  height: number,
  count: number
): number {
  const perImage = imagePriceForDimension(rules, Math.max(width, height));
  return perImage * Math.max(1, count);
}

/** 视频生成估算积分：每秒单价 × 秒数（fast 档取 video_fast，否则 standard）。 */
export function estimateVideoCredits(
  rules: PricingRulesConfig | undefined,
  seconds: number,
  fast: boolean
): number {
  const perSecond = fast
    ? rules?.video_fast?.per_second ?? VIDEO_FAST_PER_SECOND_FALLBACK
    : rules?.video_standard?.per_second ?? VIDEO_STANDARD_PER_SECOND_FALLBACK;
  return perSecond * Math.max(1, seconds);
}
