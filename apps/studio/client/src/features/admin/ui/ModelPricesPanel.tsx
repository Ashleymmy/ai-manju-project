import { RefreshCcw, Save } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { useModelPricesController } from "../controllers/useModelPricesController";
import { MAX_MODEL_CREDIT_PRICE, qualityNames, referenceSurchargeModels } from "../model/modelPrices";
import "./model-prices.css";

export function ModelPricesPanel({ readOnly }: { readOnly: boolean }) {
  const { query, draft, changes, busy, error, saved, edit, save, discard } = useModelPricesController(readOnly);
  const [group, setGroup] = useState<"images" | "videos">("images");
  const [selected, setSelected] = useState("");
  const models = draft ? Object.keys(draft[group]) : [];
  const name = models.includes(selected) ? selected : models[0];
  const audioModel = name === "seedance-1.5-pro";
  const hasReferenceSurcharge = referenceSurchargeModels.has(name);
  const resolutionOnly = group === "images" && Object.values(draft?.images[name] ?? {}).every(values => values.length === 1);
  const headers = group === "images"
    ? resolutionOnly ? ["按分辨率计价"] : query.data?.qualities.map(q => `${qualityNames[q] ?? q} · ${q}`) ?? []
    : audioModel ? ["无声", "有声"] : ["无参考视频", "有参考视频", ...(hasReferenceSurcharge ? ["参考视频附加费"] : [])];

  return <section className="real-admin-section model-prices-panel">
    <div className="admin-panel-head">
      <div><h2>模型积分定价</h2><p>设置成员生成图片、视频时消耗的积分。保存后对新提交任务生效，已提交任务保持原积分记录。</p></div>
      <button type="button" className="outline-button small" disabled={busy || changes > 0 || query.isFetching} onClick={() => void query.refetch()}>
        <RefreshCcw size={14} /> 刷新
      </button>
    </div>
    <p className="model-prices-note">支持两位小数，0 表示该项免费。同一任务汇总后向上取整；独立任务分别取整，活动折扣继续生效。Agent 对话保持免费。</p>
    {query.isPending ? <p role="status">正在读取当前定价…</p> : null}
    {query.isError ? <p role="alert">定价读取失败，请刷新重试。</p> : null}
    {draft && query.data ? <>
      <div className="model-prices-controls">
        <div className="model-prices-tabs" aria-label="生成类型">
          <button type="button" aria-pressed={group === "images"} onClick={() => setGroup("images")}>图片定价</button>
          <button type="button" aria-pressed={group === "videos"} onClick={() => setGroup("videos")}>视频定价</button>
        </div>
        <label className="model-prices-selector">模型
          <select value={name} onChange={e => setSelected(e.target.value)}>
            {models.map(model => <option key={model} value={model}>{model}</option>)}
          </select>
        </label>
      </div>
      {group === "images" ? <label className="model-prices-reference">
        <span>参考图片附加费 <small>积分 / 张（每个输出均计入，蒙版不计费）</small></span>
        <Input aria-label="参考图片附加费" type="number" min="0" max={MAX_MODEL_CREDIT_PRICE} step="0.01" value={draft.image_reference}
          disabled={readOnly || busy} onChange={e => edit(next => { next.image_reference = e.target.value; })} />
      </label> : null}
      <div className="model-prices-scroll">
        <table>
          <caption>{name} · {group === "images" ? "积分 / 张" : "积分 / 秒"}</caption>
          <thead><tr><th scope="col">分辨率</th>{headers.map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{Object.entries(draft[group][name] ?? {}).map(([resolution, values]) => <tr key={`${name}-${resolution}`}>
            <th scope="row">{resolution.toUpperCase()}</th>
            {headers.map((label, index) => <td key={label}>
              {values[index] === undefined ? <span title="该模型不支持此画质">—</span> : <Input
                aria-label={`${name} ${resolution} ${label}`} type="number" min="0" max={MAX_MODEL_CREDIT_PRICE} step="0.01"
                value={values[index]} disabled={readOnly || busy}
                onChange={e => edit(next => { next[group][name][resolution][index] = e.target.value; })}
              />}
            </td>)}
          </tr>)}</tbody>
        </table>
      </div>
      <div className="model-prices-note">
        <p>引用视频时，总积分 =（有参考视频单价 + 参考视频附加费）× 生成视频秒数。多个参考视频只加一次单价，不按参考视频数量或时长累计；只引用图片、音频时，使用无参考视频单价。Seedance 1.5 按无声／有声计价。</p>
        <p>不支持画质档位的图片模型按分辨率单价计费。尺寸为自动，或支持画质档位的模型选择自动画质时，按（基础兜底单价 + 参考图片张数 × 参考图片附加费）× 输出张数计费，蒙版不计费。视频自动时长仍沿用基础规则。</p>
        <p><Link href="/admin/plans-config">基础兜底价格与活动折扣</Link> · <Link href="/admin/consumptions">平台模型成本</Link>单独管理。</p>
      </div>
      {error ? <p role="alert" className="model-prices-error">{error}</p> : null}
      <div className="model-prices-footer">
        <p role="status">{readOnly ? "当前账号仅可查看定价。" : saved ? "已保存，新任务将使用最新定价。" : changes ? `有 ${changes} 项未保存修改（包含其他模型）。` : "当前显示已生效的定价。"}</p>
        {!readOnly ? <div>
          <button type="button" className="outline-button small" disabled={busy || !changes} onClick={discard}>撤销未保存修改</button>
          <button type="button" className="vermilion-button" disabled={busy || !changes} onClick={() => void save()}>
            <Save size={14} /> {busy ? "保存中…" : "保存全部定价"}
          </button>
        </div> : null}
      </div>
    </> : null}
  </section>;
}
