import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Sparkles, X } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchImageModelCatalog, modelQueryKeys } from "@/entities/model";
import { modelOptions } from "@/shared/lib/modelSelection";
import { useAuth } from "@/contexts/AuthContext";
import { formatCredits, PRICE_REFRESH_INTERVAL_MS, fetchGenerationQuote } from "@/features/member";
import { CREATION_BUDGET_SIZE, creationBudgetEstimate, creationBudgetSpecs } from "./creationBudget";

export function CreationBudgetPopover({ available }: { available?: number }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" className="creation-budget-trigger" title="灵感还能走多远" aria-label="灵感还能走多远">
        <Sparkles size={14} strokeWidth={1.7} aria-hidden="true" />
        <span>灵感还能走多远</span>
        <span className="creation-budget-stardust" aria-hidden="true"><i /><i /><i /></span>
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" className="creation-budget-popover" aria-labelledby={titleId}>
      <div className="creation-budget-head">
        <h3 id={titleId}><Sparkles size={16} strokeWidth={1.7} aria-hidden="true" /> 灵感还能走多远</h3>
        <button type="button" aria-label="关闭创作预估" onClick={() => setOpen(false)}><X size={16} /></button>
      </div>
      <p className="creation-budget-intro">选一组配置，看看积分能变成多少张画面。</p>
      <CreationBudgetForm available={available} />
    </PopoverContent>
  </Popover>;
}

function CreationBudgetForm({ available }: { available?: number }) {
  const modelId = useId();
  const specId = useId();
  const { user } = useAuth();
  const [model, setModel] = useState("");
  const [quality, setQuality] = useState("");
  const catalog = useQuery({
    queryKey: modelQueryKeys.capability("image"),
    queryFn: () => fetchImageModelCatalog(),
    staleTime: PRICE_REFRESH_INTERVAL_MS,
    retry: false,
  });
  const specs = creationBudgetSpecs(model);
  const configured = !catalog.isError && Boolean(catalog.data?.models.includes(model)) &&
    specs.some(spec => spec.value === quality);
  const payload = { model, size: CREATION_BUDGET_SIZE, quality, n: 1 };
  const quote = useQuery({
    queryKey: ["member", "creation-budget", user?.id, payload],
    queryFn: ({ signal }) => fetchGenerationQuote("image.generate", payload, signal),
    enabled: configured,
    placeholderData: undefined,
    staleTime: 0,
    refetchInterval: PRICE_REFRESH_INTERVAL_MS,
    retry: false,
  });
  const estimate = creationBudgetEstimate(available, quote.data);
  return <>
    <div className="creation-budget-fields">
      <label htmlFor={modelId}>图片模型
        <span className="creation-budget-select">
          <select id={modelId} aria-label="图片模型" value={model} disabled={!catalog.data?.models.length || catalog.isError} onChange={event => { setModel(event.target.value); setQuality(""); }}>
            <option value="" disabled>{catalog.isPending ? "正在读取模型…" : "选择图片模型"}</option>
            {modelOptions(catalog.data?.models || [], model, catalog.data?.labels).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      </label>
      <label htmlFor={specId}>图片规格
        <span className="creation-budget-select">
          <select id={specId} aria-label="图片规格" value={quality} disabled={!model || catalog.isError} onChange={event => setQuality(event.target.value)}>
            <option value="" disabled>选择规格</option>
            {specs.map(spec => <option key={spec.value} value={spec.value}>{spec.label}</option>)}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      </label>
    </div>
    <div className="creation-budget-result" role="status" aria-live="polite">
      {catalog.isError ? <><p>图片模型暂未能加载</p><button type="button" onClick={() => void catalog.refetch()}>重新加载</button></>
        : catalog.isPending ? <p>正在读取可用模型…</p>
          : !catalog.data.models.length ? <p>暂时没有可用的图片模型</p>
            : !configured ? <p>选好模型和规格，就能查看创作预估。</p>
              : quote.isFetching ? <p>正在获取当前报价…</p>
                : quote.isError ? <><p>报价暂不可用，请重试</p><button type="button" onClick={() => void quote.refetch()}>重新报价</button></>
                  : estimate.count !== undefined ? <>
                    <span>约可创作</span>
                    <div><strong>{formatCredits(estimate.count)}</strong><span>张图片</span><Sparkles size={20} aria-hidden="true" /></div>
                    <small>{estimate.count === 0 ? "当前可用积分不足以生成一张此规格图片" : `当前单张报价 ${formatCredits(estimate.credits!)} 积分`}</small>
                  </> : <p>{estimate.message}</p>}
    </div>
    <p className="creation-budget-note">按 1:1 图片、无参考图、每次生成 1 张估算。仅查看，不扣积分；最终以生成时的报价为准。</p>
  </>;
}
