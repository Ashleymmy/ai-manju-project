import { PackageOpen, Pencil, RefreshCcw, SlidersHorizontal } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { discountLabel, formatCents, formatCredits, StatusPill } from "@/features/member";

import type { PlansConfigController } from "../controllers/usePlansConfigController";
import { ADMIN_EDITABLE_CONFIGS } from "../model/memberAdmin";
import { AdminQueryState } from "./components/adminBits";

/**
 * 模块5 套餐与活动配置面板：会员套餐 / 积分包 / 计费配置三区块。
 * 金额输入为元、提交转 cents；配置编辑走 key 白名单 + JSON 校验。
 * readOnly（auditor）时隐藏全部编辑入口。
 */
export function PlansConfigPanel({ controller, readOnly }: { controller: PlansConfigController; readOnly: boolean }) {
  const {
    closeConfigDialog,
    closePackageDialog,
    closePlanDialog,
    configBusy,
    configError,
    configMeta,
    configTargetKey,
    configText,
    configs,
    isError,
    isPending,
    openConfigDialog,
    openPackageDialog,
    openPlanDialog,
    packageBusy,
    packageDraft,
    packageErrors,
    packageTarget,
    packages,
    planBusy,
    planDraft,
    planErrors,
    planTarget,
    plans,
    reload,
    setConfigText,
    setPackageDraft,
    setPlanDraft,
    submitConfig,
    submitPackage,
    submitPlan,
  } = controller;

  const targetConfigMeta = configTargetKey ? configMeta(configTargetKey) : undefined;

  return (
    <section className="real-admin-section">
      <div className="admin-panel-head">
        <div>
          <p className="eyebrow">BILLING / CONFIG</p>
          <h2>套餐与活动配置</h2>
          <small>套餐、积分包与活动/注册配置实时生效；改动会写入审计日志。</small>
        </div>
        <button className="outline-button small" onClick={() => void reload()}>
          <RefreshCcw size={14} /> 刷新
        </button>
      </div>

      <AdminQueryState
        isPending={isPending}
        isError={isError}
        isEmpty={false}
        emptyText=""
        onRetry={() => void reload()}
      >
        {/* 会员套餐 */}
        <section className="admin-config-block">
          <div className="member-section-head">
            <h3>会员套餐</h3>
          </div>
          <div className="admin-table">
            <div className="admin-table-head admin-plan-row">
              <span>套餐</span>
              <span>月价</span>
              <span>年价</span>
              <span>月积分</span>
              <span>并发（图/视频）</span>
              <span>购积分折扣</span>
              <span>状态</span>
              <span />
            </div>
            {plans.map(plan => (
              <div className="admin-table-row admin-plan-row" key={plan.id}>
                <span className="admin-cell-main">
                  <b>{plan.name}</b>
                  <small>{plan.code}</small>
                </span>
                <span className="member-cell-num">{formatCents(plan.price_month_cents)}</span>
                <span className="member-cell-num">
                  {plan.price_year_cents > 0 ? formatCents(plan.price_year_cents) : "未开通"}
                </span>
                <span className="member-cell-num">{formatCredits(plan.monthly_credits)}</span>
                <span>{plan.image_concurrency} / {plan.video_concurrency}</span>
                <span>{discountLabel(plan.credit_discount_bps)}</span>
                <span>
                  <StatusPill tone={plan.enabled ? "green" : "gray"}>{plan.enabled ? "上架中" : "已下架"}</StatusPill>
                </span>
                {!readOnly ? (
                  <span className="admin-row-actions">
                    <button type="button" title="编辑套餐" onClick={() => openPlanDialog(plan)} disabled={planBusy}>
                      <Pencil size={14} />
                    </button>
                  </span>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        </section>

        {/* 积分包 */}
        <section className="admin-config-block">
          <div className="member-section-head">
            <h3>直购积分包</h3>
          </div>
          <div className="admin-table">
            <div className="admin-table-head admin-package-row">
              <span>积分包</span>
              <span>积分</span>
              <span>价格</span>
              <span>排序</span>
              <span>状态</span>
              <span />
            </div>
            {packages.map(pkg => (
              <div className="admin-table-row admin-package-row" key={pkg.id}>
                <span className="admin-cell-main">
                  <b>{pkg.name}</b>
                  <small>{pkg.id}</small>
                </span>
                <span className="member-cell-num">{formatCredits(pkg.credits)}</span>
                <span className="member-cell-num">{formatCents(pkg.price_cents)}</span>
                <span>{pkg.sort_order}</span>
                <span>
                  <StatusPill tone={pkg.enabled ? "green" : "gray"}>{pkg.enabled ? "上架中" : "已下架"}</StatusPill>
                </span>
                {!readOnly ? (
                  <span className="admin-row-actions">
                    <button type="button" title="编辑积分包" onClick={() => openPackageDialog(pkg)} disabled={packageBusy}>
                      <Pencil size={14} />
                    </button>
                  </span>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        </section>

        {/* 计费配置（key 白名单） */}
        <section className="admin-config-block">
          <div className="member-section-head">
            <h3>活动与注册配置</h3>
          </div>
          <div className="admin-table">
            <div className="admin-table-head admin-config-row">
              <span>配置</span>
              <span>当前值</span>
              <span>最近更新</span>
              <span />
            </div>
            {ADMIN_EDITABLE_CONFIGS.map(meta => {
              const current = configs.find(item => item.key === meta.key);
              return (
                <div className="admin-table-row admin-config-row" key={meta.key}>
                  <span className="admin-cell-main">
                    <b>{meta.label}</b>
                    <small>{meta.key}</small>
                  </span>
                  <span className="admin-cell-ellipsis admin-config-value" title={current ? JSON.stringify(current.value) : ""}>
                    {current ? JSON.stringify(current.value) : "未配置（用默认）"}
                  </span>
                  <span>{current?.updated_at ? current.updated_at.slice(0, 10) : "—"}</span>
                  {!readOnly ? (
                    <span className="admin-row-actions">
                      <button type="button" title="编辑配置" onClick={() => openConfigDialog(meta.key)} disabled={configBusy}>
                        <SlidersHorizontal size={14} />
                      </button>
                    </span>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </AdminQueryState>

      {/* 套餐编辑弹窗 */}
      <Dialog
        open={planTarget !== null}
        onOpenChange={nextOpen => {
          if (!nextOpen) closePlanDialog();
        }}
      >
        <DialogContent className="sm:max-w-[640px]" showCloseButton={!planBusy}>
          <DialogHeader>
            <DialogTitle>编辑套餐</DialogTitle>
            <DialogDescription>
              <PackageOpen size={14} /> 套餐 {planTarget?.name}（{planTarget?.code}）；价格单位为「元」，保存时换算为 cents。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <label className="grid gap-2 text-sm">
              <span>套餐名称</span>
              <Input
                value={planDraft.name}
                onChange={event => setPlanDraft(draft => ({ ...draft, name: event.target.value }))}
                disabled={planBusy}
              />
              {planErrors.name ? <span className="text-sm text-destructive">{planErrors.name}</span> : null}
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span>月价（元）</span>
                <Input
                  value={planDraft.price_month_yuan}
                  onChange={event => setPlanDraft(draft => ({ ...draft, price_month_yuan: event.target.value }))}
                  disabled={planBusy}
                />
                {planErrors.price_month_yuan ? (
                  <span className="text-sm text-destructive">{planErrors.price_month_yuan}</span>
                ) : null}
              </label>
              <label className="grid gap-2 text-sm">
                <span>年价（元，0 = 未开通）</span>
                <Input
                  value={planDraft.price_year_yuan}
                  onChange={event => setPlanDraft(draft => ({ ...draft, price_year_yuan: event.target.value }))}
                  disabled={planBusy}
                />
                {planErrors.price_year_yuan ? (
                  <span className="text-sm text-destructive">{planErrors.price_year_yuan}</span>
                ) : null}
              </label>
              <label className="grid gap-2 text-sm">
                <span>每月积分</span>
                <Input
                  value={planDraft.monthly_credits}
                  onChange={event => setPlanDraft(draft => ({ ...draft, monthly_credits: event.target.value }))}
                  disabled={planBusy}
                />
                {planErrors.monthly_credits ? (
                  <span className="text-sm text-destructive">{planErrors.monthly_credits}</span>
                ) : null}
              </label>
              <label className="grid gap-2 text-sm">
                <span>购积分折扣基点（8000 = 8 折）</span>
                <Input
                  value={planDraft.credit_discount_bps}
                  onChange={event => setPlanDraft(draft => ({ ...draft, credit_discount_bps: event.target.value }))}
                  disabled={planBusy}
                />
                {planErrors.credit_discount_bps ? (
                  <span className="text-sm text-destructive">{planErrors.credit_discount_bps}</span>
                ) : null}
              </label>
              <label className="grid gap-2 text-sm">
                <span>图片并发</span>
                <Input
                  value={planDraft.image_concurrency}
                  onChange={event => setPlanDraft(draft => ({ ...draft, image_concurrency: event.target.value }))}
                  disabled={planBusy}
                />
                {planErrors.image_concurrency ? (
                  <span className="text-sm text-destructive">{planErrors.image_concurrency}</span>
                ) : null}
              </label>
              <label className="grid gap-2 text-sm">
                <span>视频并发</span>
                <Input
                  value={planDraft.video_concurrency}
                  onChange={event => setPlanDraft(draft => ({ ...draft, video_concurrency: event.target.value }))}
                  disabled={planBusy}
                />
                {planErrors.video_concurrency ? (
                  <span className="text-sm text-destructive">{planErrors.video_concurrency}</span>
                ) : null}
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={planDraft.enabled}
                onChange={event => setPlanDraft(draft => ({ ...draft, enabled: event.target.checked }))}
                disabled={planBusy}
              />
              <span>上架（下架后用户端不可购买）</span>
            </label>
            {planErrors.form ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{planErrors.form}</p>
            ) : null}
          </div>
          <DialogFooter>
            <button className="outline-button small" type="button" onClick={() => closePlanDialog()} disabled={planBusy}>
              取消
            </button>
            <button className="vermilion-button" type="button" onClick={() => void submitPlan()} disabled={planBusy}>
              {planBusy ? "保存中…" : "保存套餐"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 积分包编辑弹窗 */}
      <Dialog
        open={packageTarget !== null}
        onOpenChange={nextOpen => {
          if (!nextOpen) closePackageDialog();
        }}
      >
        <DialogContent className="sm:max-w-[520px]" showCloseButton={!packageBusy}>
          <DialogHeader>
            <DialogTitle>编辑积分包</DialogTitle>
            <DialogDescription>积分包 {packageTarget?.name}（{packageTarget?.id}）。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <label className="grid gap-2 text-sm">
              <span>名称</span>
              <Input
                value={packageDraft.name}
                onChange={event => setPackageDraft(draft => ({ ...draft, name: event.target.value }))}
                disabled={packageBusy}
              />
              {packageErrors.name ? <span className="text-sm text-destructive">{packageErrors.name}</span> : null}
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span>积分数量</span>
                <Input
                  value={packageDraft.credits}
                  onChange={event => setPackageDraft(draft => ({ ...draft, credits: event.target.value }))}
                  disabled={packageBusy}
                />
                {packageErrors.credits ? (
                  <span className="text-sm text-destructive">{packageErrors.credits}</span>
                ) : null}
              </label>
              <label className="grid gap-2 text-sm">
                <span>价格（元）</span>
                <Input
                  value={packageDraft.price_yuan}
                  onChange={event => setPackageDraft(draft => ({ ...draft, price_yuan: event.target.value }))}
                  disabled={packageBusy}
                />
                {packageErrors.price_yuan ? (
                  <span className="text-sm text-destructive">{packageErrors.price_yuan}</span>
                ) : null}
              </label>
            </div>
            <label className="grid gap-2 text-sm">
              <span>排序值（越小越靠前）</span>
              <Input
                value={packageDraft.sort_order}
                onChange={event => setPackageDraft(draft => ({ ...draft, sort_order: event.target.value }))}
                disabled={packageBusy}
              />
              {packageErrors.sort_order ? (
                <span className="text-sm text-destructive">{packageErrors.sort_order}</span>
              ) : null}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={packageDraft.enabled}
                onChange={event => setPackageDraft(draft => ({ ...draft, enabled: event.target.checked }))}
                disabled={packageBusy}
              />
              <span>上架</span>
            </label>
            {packageErrors.form ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{packageErrors.form}</p>
            ) : null}
          </div>
          <DialogFooter>
            <button className="outline-button small" type="button" onClick={() => closePackageDialog()} disabled={packageBusy}>
              取消
            </button>
            <button className="vermilion-button" type="button" onClick={() => void submitPackage()} disabled={packageBusy}>
              {packageBusy ? "保存中…" : "保存积分包"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 配置编辑弹窗（textarea JSON + 校验） */}
      <Dialog
        open={configTargetKey !== ""}
        onOpenChange={nextOpen => {
          if (!nextOpen) closeConfigDialog();
        }}
      >
        <DialogContent className="sm:max-w-[640px]" showCloseButton={!configBusy}>
          <DialogHeader>
            <DialogTitle>编辑配置：{targetConfigMeta?.label || configTargetKey}</DialogTitle>
            <DialogDescription>
              仅白名单 key 可写；值必须是合法 JSON。示例：{targetConfigMeta?.hint}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <textarea
              className="provider-map-textarea"
              value={configText}
              onChange={event => setConfigText(event.target.value)}
              disabled={configBusy}
              rows={10}
              spellCheck={false}
              placeholder={targetConfigMeta?.hint}
            />
            {configError ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{configError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <button className="outline-button small" type="button" onClick={() => closeConfigDialog()} disabled={configBusy}>
              取消
            </button>
            <button className="vermilion-button" type="button" onClick={() => void submitConfig()} disabled={configBusy}>
              {configBusy ? "保存中…" : "保存配置"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
