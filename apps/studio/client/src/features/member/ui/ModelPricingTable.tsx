import type { MemberPricing } from "../model/types";

export function ModelPricingTable({ prices }: { prices: MemberPricing["model_prices"] }) {
  if (!prices) return <p>模型价目表暂不可用，请稍后刷新。</p>;
  const rows: Array<[string, string, string]> = [];
  for (const [model, resolutions] of Object.entries(prices.images)) {
    for (const [resolution, qualities] of Object.entries(resolutions)) {
      qualities.forEach((price, index) => rows.push([model, `${resolution.toUpperCase()} / ${prices.qualities[index]}`, `${price} / 张`]));
    }
  }
  for (const [model, resolutions] of Object.entries(prices.videos)) {
    for (const [resolution, [base, reference, surcharge]] of Object.entries(resolutions)) {
      rows.push([model, resolution.toUpperCase(), model === "seedance-1.5-pro"
        ? `无声 ${base} / 有声 ${reference} 积分/秒`
        : surcharge ? `无参考视频 ${base} / 有参考视频 ${reference} + ${surcharge} = ${Number((reference + surcharge).toFixed(2))} 积分/生成秒`
        : `无参考视频 ${base} / 有参考视频 ${reference} 积分/秒`]);
    }
  }
  return <>
    <p className="member-tip">图片生成每张参考图另加 {prices.image_reference} 积分。视频生成仅在引用视频时加收参考视频附加费，按生成视频时长计算；引用图片、音频不加收此费用。同一任务汇总后向上取整，画布和批量生成的独立任务分别取整。Agent 对话免费。</p>
    <p className="member-tip">图片尺寸或画质为自动时，生成单价沿用基础兜底价，参考图仍逐张加收附加费，每个输出均计入。</p>
    <div className="member-table">
      <div className="member-table-head member-price-row"><span>模型</span><span>规格 / 画质</span><span>积分</span></div>
      {rows.map(([name, spec, price]) => <div key={`${name}:${spec}`} className="member-table-row member-price-row"><span>{name}</span><span>{spec}</span><span>{price}</span></div>)}
    </div>
  </>;
}
