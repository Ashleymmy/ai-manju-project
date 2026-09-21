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
        : surcharge ? `${base} 积分/秒 + 参考视频 ${surcharge} 积分/秒`
        : `无参考视频 ${base} / 有参考视频 ${reference} 积分/秒`]);
    }
  }
  return <>
    <p className="member-tip">按会员价目表：每张参考图另加 {prices.image_reference} 积分；同一任务汇总后向上取整。画布和批量生成的独立任务分别取整。Agent 对话免费，图片、视频任务按模型计费。</p>
    <div className="member-table">
      <div className="member-table-head member-price-row"><span>模型</span><span>规格 / 画质</span><span>积分</span></div>
      {rows.map(([name, spec, price]) => <div key={`${name}:${spec}`} className="member-table-row member-price-row"><span>{name}</span><span>{spec}</span><span>{price}</span></div>)}
    </div>
  </>;
}
