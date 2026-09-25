import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { fetchGenerationQuote } from "../services/memberApi";
import { useMemberOverviewQuery } from "../controllers/useMemberOverview";
import { formatCredits } from "../model/format";
import { PRICE_REFRESH_INTERVAL_MS } from "../model/constants";
import "./generationPrice.css";

export type GenerationPriceProps = {
  kind?: "image" | "video" | "free";
  model?: string;
  size?: string;
  quality?: string;
  count?: number;
  references?: number;
  resolution?: string;
  seconds?: number | string;
  audio?: boolean;
  referenceVideos?: number;
  /** Canvas/comic fan out into independent jobs, each rounded separately. */
  tasks?: number;
  /** Compact toolbar presentation: icon plus value without the explanatory prefix. */
  compact?: boolean;
};


/** Shared by creation, retry and editing controls. Never show stale parameter quotes. */
export function GenerationPrice(props: GenerationPriceProps) {
  if (props.kind === "free") return <span className="generation-price">免费</span>;
  return <QuotedGenerationPrice {...props} />;
}

function QuotedGenerationPrice({ kind = "image", model, size, quality, count = 1, references = 0, resolution, seconds, audio, referenceVideos = 0, tasks = 1, compact = false }: GenerationPriceProps) {
  const payload = kind === "image"
    ? { model, size, quality, n: count, references: Array.from({ length: references }, () => ({ field_name: "image" })) }
    : { model, resolution, duration: Number(seconds), generate_audio: audio, content: Array.from({ length: referenceVideos }, () => ({ type: "video_url" })) };
  const jobType = kind === "image" ? references ? "image.edit" : "image.generate" : "video.generate";
  const quote = useQuery({
    queryKey: ["member", "quote", jobType, payload],
    queryFn: ({ signal }) => fetchGenerationQuote(jobType, payload, signal),
    enabled: Boolean(model),
    staleTime: 15_000,
    refetchInterval: PRICE_REFRESH_INTERVAL_MS,
    retry: 1,
  });
  let label = !model ? "选择模型后报价" : quote.isError ? "报价暂不可用" : "报价中…";
  let explanation = "按最终提交参数计价，成功才扣费；失败或取消释放冻结积分。";
  if (quote.data?.params && Number.isFinite(quote.data.credits)) {
    const { credits, params } = quote.data;
    if (kind === "video" && params.billing_mode === "actual_video_duration") {
      label = `预冻结 ${formatCredits(credits * tasks)} 积分 · 按实际时长结算`;
      const duration = params.reserve_duration_sec ? `最长 ${params.reserve_duration_sec} 秒` : "模型支持的最长时长";
      const reference = params.reference_per_second
        ? `已含参考视频附加费：基础 ${params.base_per_second} + 附加 ${params.reference_per_second} = ${params.per_second} 积分/生成秒。`
        : "";
      explanation = `自动时长按${duration}预冻结积分。${reference}成功后按实际生成时长和提交时的价格结算，剩余冻结积分自动释放；失败或取消释放冻结积分。`;
    }
    else if (params.pricing_source === "membership_price_sheet") {
      label = `预计 ${formatCredits(credits * tasks)} 积分`;
      if (params.reference_per_second) explanation = `已含参考视频附加费：基础 ${params.base_per_second} + 附加 ${params.reference_per_second} = ${params.per_second} 积分/生成秒，按生成视频时长计算；成功才扣费。`;
    }
    else if (params.pricing_source === "image_auto_fallback") {
      label = `预计 ${formatCredits(credits * tasks)} 积分 · 自动规格`;
      explanation = `每张输出按基础价 ${params.base_per_image} + ${params.reference_count} 张参考图 × ${params.reference_per_image} 积分计算，活动折扣后汇总取整；成功才扣费。`;
    }
    else if (params.range_min !== undefined && params.range_max !== undefined) {
      label = `${formatCredits(params.range_min * tasks)}–${formatCredits(params.range_max * tasks)} 积分 · 自动规格`;
      explanation = "价目表范围；请选择支持的尺寸和画质获取本次准确报价。";
    } else if (params.reference_per_second) {
      label = `${params.per_second ?? "—"} 积分/秒 · 含视频参考附加费`;
      explanation = "附加费按生成视频时长计算；当前时长自动，仍沿用基础扣费规则。选择明确时长可获取准确报价。";
    } else if (params.per_second !== undefined) label = `${params.per_second} 积分/秒 · 时长自动`;
    else {
      label = `预估 ${formatCredits(credits * tasks)} 积分`;
      explanation = "当前模型或自动规格未匹配价目表，按现有基础规则预估；选择明确规格可获取模型报价。";
    }
  }
  if (compact) {
    let compactLabel = "—";
    if (quote.data?.params && Number.isFinite(quote.data.credits)) {
      const { credits, params } = quote.data;
      if (kind === "video" && params.billing_mode === "actual_video_duration") compactLabel = `预冻结 ${formatCredits(credits * tasks)}`;
      else if (params.pricing_source === "membership_price_sheet") compactLabel = formatCredits(credits * tasks);
      else if (params.range_min !== undefined && params.range_max !== undefined) compactLabel = `${formatCredits(params.range_min * tasks)}–${formatCredits(params.range_max * tasks)}`;
      else if (params.reference_per_second) compactLabel = `${params.per_second ?? "—"}/秒`;
      else if (params.per_second !== undefined) compactLabel = `${params.per_second}/秒`;
      else compactLabel = formatCredits(credits * tasks);
    }
    return <span className="generation-price generation-price-compact" title={explanation} aria-label={label} aria-live="polite"><Coins size={13} aria-hidden="true" /><span>{compactLabel}</span></span>;
  }
  return <span className="generation-price" title={explanation} aria-live="polite">{label}</span>;
}

/** Available excludes frozen credits, and expires/refreshes while creating. */
export function CreditBalance() {
  const query = useMemberOverviewQuery();
  const available = query.data ? query.data.permanent_available + query.data.limited_available : undefined;
  return <a className="creation-credit-balance" href="/member" title="可用积分（不含已冻结积分），点击查看明细" aria-live="polite">
    <span>可用积分</span><strong>{query.isError ? "暂不可用" : available === undefined ? "…" : formatCredits(available)}</strong>
  </a>;
}
