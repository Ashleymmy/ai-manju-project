import type { ModelCreditPrices } from "@/features/member";

/** Matches the API unit price bound, with up to two fractional credit digits. */
export const MAX_MODEL_CREDIT_PRICE = 1_000_000;
export const modelPricesQueryKey = ["admin", "model-prices"] as const;
export const referenceDurationModels = new Set(["minimax-h3", "seedance-2.5", "wan-3.0", "wan-3.0-prime"]);
export const qualityNames: Record<string, string> = { low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高" };

export type PriceDraft = {
  images: Record<string, Record<string, string[]>>;
  videos: Record<string, Record<string, string[]>>;
  image_reference: string;
};

export function modelPriceDraft(prices: ModelCreditPrices): PriceDraft {
  const map = (models: ModelCreditPrices["images"]) => Object.fromEntries(
    Object.entries(models).map(([name, specs]) => [name, Object.fromEntries(
      Object.entries(specs).map(([resolution, values]) => [resolution, values.map(String)]),
    )]),
  );
  return { images: map(prices.images), videos: map(prices.videos), image_reference: String(prices.image_reference) };
}

export function parsePriceDraft(draft: PriceDraft, base: ModelCreditPrices): ModelCreditPrices {
  const price = (text: string, label: string) => {
    const value = Number(text);
    if (!/^\d+(\.\d{1,2})?$/.test(text.trim()) || !Number.isFinite(value) || value > MAX_MODEL_CREDIT_PRICE) {
      throw new Error(`${label}：请输入 0–${MAX_MODEL_CREDIT_PRICE.toLocaleString()} 的积分，最多两位小数。`);
    }
    return value;
  };
  const map = (models: PriceDraft["images"]) => Object.fromEntries(
    Object.entries(models).map(([name, specs]) => [name, Object.fromEntries(
      Object.entries(specs).map(([resolution, values]) => [resolution, values.map(v => price(v, `${name} / ${resolution}`))]),
    )]),
  );
  return { images: map(draft.images), videos: map(draft.videos), image_reference: price(draft.image_reference, "参考图片附加费"), qualities: [...base.qualities] };
}

export function changedPriceCount(draft: PriceDraft, base: ModelCreditPrices): number {
  let count = draft.image_reference.trim() === "" || Number(draft.image_reference) !== base.image_reference ? 1 : 0;
  for (const group of ["images", "videos"] as const) {
    for (const [name, specs] of Object.entries(draft[group])) {
      for (const [res, values] of Object.entries(specs)) {
        values.forEach((value, i) => { if (value.trim() === "" || Number(value) !== base[group][name][res][i]) count++; });
      }
    }
  }
  return count;
}
