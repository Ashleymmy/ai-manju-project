import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { publicApiError } from "@/shared/api/errors";
import { createAdjustNonce, type AdminMemberUser } from "../model/memberAdmin";
import { adminQueryKeys } from "../model/queryKeys";
import { changeMemberMembership, listAdminBillingPlans } from "../services/adminMemberApi";

const INTERNAL_PLAN_CODE = "internal_test";
const DEFAULT_TERM_DAYS = 30;
const MAX_TEST_CREDITS = 1_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function MembershipDialog({ target, onClose, onSaved }: { target: AdminMemberUser; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const plans = useQuery({ queryKey: adminQueryKeys.billingPlans(), queryFn: listAdminBillingPlans });
  const [planId, setPlanId] = useState(target.plan_id || "");
  const [expiry, setExpiry] = useState(() => {
    const date = new Date(Math.max(Date.now() + DEFAULT_TERM_DAYS * DAY_MS, Date.parse(target.member_expires_at || "") || 0));
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [quota, setQuota] = useState(String(target.test_credits ?? 0));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ fingerprint: string; nonce: string } | null>(null);
  const selected = plans.data?.find(plan => plan.id === planId);
  const internal = selected?.code === INTERNAL_PLAN_CODE;
  const save = async () => {
    if (busy) return;
    if (!reason.trim()) { setError("请填写变更原因"); return; }
    if (planId && (!expiry || !Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now())) { setError("到期时间必须晚于当前时间"); return; }
    const amount = Number(quota);
    if (internal && (!quota.trim() || !Number.isSafeInteger(amount) || amount < 0 || amount > MAX_TEST_CREDITS)) { setError("测试额度须为 0 至 10 亿的整数"); return; }
    const body = { plan_id: planId, expected_membership_id: target.membership_id || "", expires_at: planId ? new Date(expiry).toISOString() : undefined, test_credits: internal ? amount : undefined, reason: reason.trim() };
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, nonce: createAdjustNonce() };
    setBusy(true); setError("");
    try { await changeMemberMembership(target.user_id, { ...body, nonce: attempt.current.nonce }); await onSaved(); onClose(); }
    catch (err) { setError(publicApiError(err, "会员变更失败，请保留表单重试；若记录已被他人修改，请刷新成员列表")); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent showCloseButton={!busy}>
      <DialogHeader><DialogTitle>变更会员等级</DialogTitle><DialogDescription>{target.display_name || target.username} · {target.user_id}</DialogDescription></DialogHeader>
      <div className="grid gap-4">
        <label className="grid gap-2 text-sm">会员等级<select className="h-10 rounded-md border bg-background px-3" value={planId} onChange={e => setPlanId(e.target.value)} disabled={busy || plans.isPending || plans.isError}>
          <option value="">免费成员</option>{plans.data?.filter(plan => plan.enabled || plan.code === INTERNAL_PLAN_CODE).map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
        </select></label>
        {plans.isError && <p role="alert">套餐加载失败。<button onClick={() => void plans.refetch()}>重试</button></p>}
        {planId && <label className="grid gap-2 text-sm">到期时间（本地时间）<Input type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)} onBlur={e => setExpiry(e.target.value)} disabled={busy} /></label>}
        {internal && <label className="grid gap-2 text-sm">每 30 天测试积分额度<Input type="number" min={0} max={MAX_TEST_CREDITS} step={1} value={quota} onChange={e => setQuota(e.target.value)} disabled={busy} /><small>0 表示不自动发放。测试任务正常扣积分，并记录平台成本。</small></label>}
        <label className="grid gap-2 text-sm">变更原因<Input value={reason} maxLength={500} onChange={e => setReason(e.target.value)} disabled={busy} placeholder="如：内部验收、运营开通、调整服务期限" /></label>
        <p className="text-sm text-muted-foreground">立即替换当前会员，并取消尚未开始的续期。已有积分保留至原到期日，新周期单独发放额度；改为免费成员后停止会员发放。此操作不改变后台管理权限。</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter><button className="outline-button small" disabled={busy} onClick={onClose}>取消</button><button className="vermilion-button" disabled={busy || plans.isPending || plans.isError} onClick={() => void save()}>{busy ? "保存中…" : "确认变更"}</button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
