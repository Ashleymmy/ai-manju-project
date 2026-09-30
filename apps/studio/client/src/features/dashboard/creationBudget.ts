import { imageModelSupportsDetail } from "@/entities/model/imageProtocol";
import type { CreditQuote } from "@/features/member";

/** Keep this quick estimate within the currently published 1K image capability. */
export const CREATION_BUDGET_SIZE = "1024x1024";
const DETAIL_SPECS = [
  { value: "low", label: "1K · 低画质" },
  { value: "medium", label: "1K · 中画质" },
  { value: "high", label: "1K · 高画质" },
];
const RESOLUTION_SPEC = [{ value: "auto", label: "1K · 标准" }];

export function creationBudgetSpecs(model: string) {
  if (!model) return [];
  return imageModelSupportsDetail(model) ? DETAIL_SPECS : RESOLUTION_SPEC;
}

export function creationBudgetEstimate(available: number | undefined, quote: CreditQuote | undefined) {
  if (available === undefined || !Number.isFinite(available) || available < 0) {
    return { message: "可用积分暂不可用，请稍后重试。" };
  }
  if (!quote || !Number.isFinite(quote.credits) || quote.credits < 0) {
    return { message: "暂未获得有效报价，请稍后重试。" };
  }
  if (quote.params?.pricing_source !== "membership_price_sheet" ||
      quote.params.range_min !== undefined || quote.params.range_max !== undefined) {
    return { message: "此规格暂未提供明确的模型报价，请换个规格试试。" };
  }
  if (quote.credits === 0) {
    return { message: "当前报价为 0 积分，不以余额估算张数。" };
  }
  const count = Math.floor(available / quote.credits);
  if (!Number.isSafeInteger(count)) return { message: "暂无法估算张数，请稍后重试。" };
  return { count, credits: quote.credits };
}
