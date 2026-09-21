import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { publicApiError } from "@/shared/api/errors";
import { addCostRate, saveActualCost, parseCostMicros, COST_MICROS_PER_YUAN, type UsageRow } from "../services/adminUsageApi";

export function UsageCostDialog({ task, onClose, onSaved }: { task?: UsageRow; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [model, setModel] = useState(task?.model || "");
  const [provider, setProvider] = useState("");
  const [unit, setUnit] = useState("task");
  const [amount, setAmount] = useState(task?.actual_cost_micros != null ? String(task.actual_cost_micros / COST_MICROS_PER_YUAN) : "");
  const [effectiveAt, setEffectiveAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [reference, setReference] = useState(task?.cost_reference || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (busy) return;
    const micros = parseCostMicros(amount);
    if (micros == null) { setError("请输入非负人民币金额，最多 6 位小数、上限 100 万元"); return; }
    if (task ? !reference.trim() : (!model.trim() || !effectiveAt || !Number.isFinite(Date.parse(effectiveAt)))) { setError(task ? "请填写账单号或核对依据" : "请填写模型标识与生效时间"); return; }
    setBusy(true); setError("");
    try {
      if (task) await saveActualCost(task.job_id, micros, reference.trim());
      else await addCostRate({ model: model.trim(), provider: provider.trim(), unit, unit_cost_micros: micros, effective_at: new Date(effectiveAt).toISOString() });
      await onSaved(); onClose();
    } catch (err) { setError(publicApiError(err, "保存成本失败")); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent showCloseButton={!busy}>
    <DialogHeader><DialogTitle>{task ? "核对任务实际费用" : "新增模型成本单价"}</DialogTitle><DialogDescription>{task ? `${task.job_id} · ${task.model || "模型未记录"}` : "仅用于平台成本估算，不修改用户积分价格或模型接入配置。"}</DialogDescription></DialogHeader>
    <div className="grid gap-4 text-sm">
      {!task && <><label className="grid gap-2">模型标识<Input value={model} onChange={e => setModel(e.target.value)} maxLength={200} disabled={busy} placeholder="与任务记录中的模型名称一致" /></label><label className="grid gap-2">供应商标识（选填）<Input value={provider} onChange={e => setProvider(e.target.value)} maxLength={200} disabled={busy} placeholder="留空表示该模型的默认成本" /></label><label className="grid gap-2">计价单位<select className="h-10 rounded-md border bg-background px-3" value={unit} onChange={e => setUnit(e.target.value)} disabled={busy}><option value="task">每任务 / 调用</option><option value="image">每张图片</option><option value="second">每秒视频</option></select></label><label className="grid gap-2">生效时间（本地时间）<Input type="datetime-local" value={effectiveAt} onChange={e => setEffectiveAt(e.target.value)} onBlur={e => setEffectiveAt(e.target.value)} disabled={busy} /></label></>}
      <label className="grid gap-2">{task ? "任务实际总费用（人民币元，包含重试）" : "单位成本（人民币元）"}<Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} placeholder="例如 0.025" /></label>
      {task && <label className="grid gap-2">账单号 / 核对依据<Input value={reference} maxLength={500} onChange={e => setReference(e.target.value)} disabled={busy} /></label>}
      <p className="text-muted-foreground">{task ? "保存的是该任务的费用总额，重复保存不会累加；修改会记入审计日志。失败任务也可能产生供应商费用。" : "按任务创建时生效的单价估算。缺少单价或计价数量时显示待核对；历史日期的单价会影响对应历史估算，实际核对费用不变。"}</p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div><DialogFooter><button className="outline-button small" disabled={busy} onClick={onClose}>取消</button><button className="vermilion-button" disabled={busy} onClick={() => void save()}>{busy ? "保存中…" : "保存"}</button></DialogFooter>
  </DialogContent></Dialog>;
}
