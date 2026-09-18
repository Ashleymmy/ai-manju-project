import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { publicApiError } from "@/shared/api/errors";

import {
  ADMIN_EDITABLE_CONFIGS,
  parseConfigValue,
  yuanToCents,
  type AdminCreditPackage,
  type AdminMembershipPlan,
} from "../model/memberAdmin";
import { adminQueryKeys } from "../model/queryKeys";
import {
  listAdminBillingConfigs,
  listAdminBillingPackages,
  listAdminBillingPlans,
  updateAdminBillingConfig,
  updateAdminBillingPackage,
  updateAdminBillingPlan,
} from "../services/adminMemberApi";

/** 套餐编辑草稿（金额用「元」输入，提交时 ×100 转 cents）。 */
export type PlanDraft = {
  name: string;
  price_month_yuan: string;
  price_year_yuan: string;
  monthly_credits: string;
  image_concurrency: string;
  video_concurrency: string;
  credit_discount_bps: string;
  enabled: boolean;
};

export type PlanDraftErrors = Partial<Record<keyof PlanDraft | "form", string>>;

/** 积分包编辑草稿。 */
export type PackageDraft = {
  name: string;
  credits: string;
  price_yuan: string;
  sort_order: string;
  enabled: boolean;
};

export type PackageDraftErrors = Partial<Record<keyof PackageDraft | "form", string>>;

function planDraftOf(plan: AdminMembershipPlan): PlanDraft {
  return {
    name: plan.name,
    price_month_yuan: (plan.price_month_cents / 100).toString(),
    price_year_yuan: (plan.price_year_cents / 100).toString(),
    monthly_credits: String(plan.monthly_credits),
    image_concurrency: String(plan.image_concurrency),
    video_concurrency: String(plan.video_concurrency),
    credit_discount_bps: String(plan.credit_discount_bps),
    enabled: plan.enabled,
  };
}

function packageDraftOf(pkg: AdminCreditPackage): PackageDraft {
  return {
    name: pkg.name,
    credits: String(pkg.credits),
    price_yuan: (pkg.price_cents / 100).toString(),
    sort_order: String(pkg.sort_order),
    enabled: pkg.enabled,
  };
}

/**
 * 模块5 套餐与活动配置控制器：会员套餐（价格/月积分/并发/折扣/上下架）+
 * 积分包（改价/上下架）+ 计费配置（key 白名单 + textarea JSON 校验）。
 */
export function usePlansConfigController(active: boolean) {
  const plansQuery = useQuery({
    queryKey: adminQueryKeys.billingPlans(),
    queryFn: listAdminBillingPlans,
    placeholderData: previous => previous,
    enabled: active,
  });
  const packagesQuery = useQuery({
    queryKey: adminQueryKeys.billingPackages(),
    queryFn: listAdminBillingPackages,
    placeholderData: previous => previous,
    enabled: active,
  });
  const configsQuery = useQuery({
    queryKey: adminQueryKeys.billingConfigs(),
    queryFn: listAdminBillingConfigs,
    placeholderData: previous => previous,
    enabled: active,
  });

  /* ---- 套餐编辑弹窗 ---- */
  const [planTarget, setPlanTarget] = useState<AdminMembershipPlan | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanDraft>(() => planDraftOf({
    id: "", code: "", name: "", price_month_cents: 0, price_year_cents: 0,
    monthly_credits: 0, image_concurrency: 0, video_concurrency: 0,
    credit_discount_bps: 10_000, priority_rank: 0, enabled: true,
  }));
  const [planErrors, setPlanErrors] = useState<PlanDraftErrors>({});
  const [planBusy, setPlanBusy] = useState(false);

  const openPlanDialog = (plan: AdminMembershipPlan) => {
    if (planBusy) return;
    setPlanTarget(plan);
    setPlanDraft(planDraftOf(plan));
    setPlanErrors({});
  };

  const closePlanDialog = (force = false) => {
    if (planBusy && !force) return;
    setPlanTarget(null);
    setPlanErrors({});
  };

  const submitPlan = async () => {
    if (planBusy || !planTarget) return;
    const nextErrors: PlanDraftErrors = {};
    const name = planDraft.name.trim();
    if (!name) nextErrors.name = "请输入套餐名称";
    const monthCents = yuanToCents(planDraft.price_month_yuan);
    if (monthCents === null) nextErrors.price_month_yuan = "请输入有效月价";
    const yearCents = yuanToCents(planDraft.price_year_yuan);
    if (yearCents === null) nextErrors.price_year_yuan = "请输入有效年价（0 = 年付未开通）";
    const monthlyCredits = Number(planDraft.monthly_credits.trim());
    if (!Number.isInteger(monthlyCredits) || monthlyCredits < 0) nextErrors.monthly_credits = "请输入非负整数";
    const imageConcurrency = Number(planDraft.image_concurrency.trim());
    if (!Number.isInteger(imageConcurrency) || imageConcurrency < 0) nextErrors.image_concurrency = "请输入非负整数";
    const videoConcurrency = Number(planDraft.video_concurrency.trim());
    if (!Number.isInteger(videoConcurrency) || videoConcurrency < 0) nextErrors.video_concurrency = "请输入非负整数";
    const discountBps = Number(planDraft.credit_discount_bps.trim());
    if (!Number.isInteger(discountBps) || discountBps < 0 || discountBps > 10_000) {
      nextErrors.credit_discount_bps = "折扣基点需为 0–10000 的整数（8000 = 8 折）";
    }
    if (Object.keys(nextErrors).length > 0) {
      setPlanErrors(nextErrors);
      return;
    }
    setPlanBusy(true);
    try {
      await updateAdminBillingPlan(planTarget.id, {
        name,
        price_month_cents: monthCents ?? undefined,
        price_year_cents: yearCents ?? undefined,
        monthly_credits: monthlyCredits,
        image_concurrency: imageConcurrency,
        video_concurrency: videoConcurrency,
        credit_discount_bps: discountBps,
        enabled: planDraft.enabled,
      });
      toast.success(`套餐「${name}」已更新`);
      closePlanDialog(true);
      await plansQuery.refetch();
    } catch (error) {
      setPlanErrors(current => ({ ...current, form: publicApiError(error, "更新套餐失败") }));
    } finally {
      setPlanBusy(false);
    }
  };

  /* ---- 积分包编辑弹窗 ---- */
  const [packageTarget, setPackageTarget] = useState<AdminCreditPackage | null>(null);
  const [packageDraft, setPackageDraft] = useState<PackageDraft>(() => packageDraftOf({
    id: "", name: "", credits: 0, price_cents: 0, enabled: true, sort_order: 0,
  }));
  const [packageErrors, setPackageErrors] = useState<PackageDraftErrors>({});
  const [packageBusy, setPackageBusy] = useState(false);

  const openPackageDialog = (pkg: AdminCreditPackage) => {
    if (packageBusy) return;
    setPackageTarget(pkg);
    setPackageDraft(packageDraftOf(pkg));
    setPackageErrors({});
  };

  const closePackageDialog = (force = false) => {
    if (packageBusy && !force) return;
    setPackageTarget(null);
    setPackageErrors({});
  };

  const submitPackage = async () => {
    if (packageBusy || !packageTarget) return;
    const nextErrors: PackageDraftErrors = {};
    const name = packageDraft.name.trim();
    if (!name) nextErrors.name = "请输入积分包名称";
    const credits = Number(packageDraft.credits.trim());
    if (!Number.isInteger(credits) || credits <= 0) nextErrors.credits = "请输入正整数积分";
    const priceCents = yuanToCents(packageDraft.price_yuan);
    if (priceCents === null || priceCents <= 0) nextErrors.price_yuan = "请输入有效价格";
    const sortOrder = Number(packageDraft.sort_order.trim());
    if (!Number.isInteger(sortOrder)) nextErrors.sort_order = "请输入整数排序值";
    if (Object.keys(nextErrors).length > 0) {
      setPackageErrors(nextErrors);
      return;
    }
    setPackageBusy(true);
    try {
      await updateAdminBillingPackage(packageTarget.id, {
        name,
        credits,
        price_cents: priceCents ?? undefined,
        sort_order: sortOrder,
        enabled: packageDraft.enabled,
      });
      toast.success(`积分包「${name}」已更新`);
      closePackageDialog(true);
      await packagesQuery.refetch();
    } catch (error) {
      setPackageErrors(current => ({ ...current, form: publicApiError(error, "更新积分包失败") }));
    } finally {
      setPackageBusy(false);
    }
  };

  /* ---- 计费配置编辑（textarea JSON + 白名单校验） ---- */
  const [configTargetKey, setConfigTargetKey] = useState("");
  const [configText, setConfigText] = useState("");
  const [configError, setConfigError] = useState("");
  const [configBusy, setConfigBusy] = useState(false);

  const configMeta = (key: string) => ADMIN_EDITABLE_CONFIGS.find(item => item.key === key);

  const openConfigDialog = (key: string) => {
    if (configBusy || !configMeta(key)) return;
    const current = (configsQuery.data || []).find(item => item.key === key);
    setConfigTargetKey(key);
    setConfigText(
      current && current.value !== undefined && current.value !== null
        ? JSON.stringify(current.value, null, 2)
        : "",
    );
    setConfigError("");
  };

  const closeConfigDialog = (force = false) => {
    if (configBusy && !force) return;
    setConfigTargetKey("");
    setConfigText("");
    setConfigError("");
  };

  const submitConfig = async () => {
    if (configBusy || !configTargetKey) return;
    const meta = configMeta(configTargetKey);
    if (!meta) return;
    const parsed = parseConfigValue(configText, meta.schema);
    if (!parsed.ok) {
      setConfigError(parsed.error);
      return;
    }
    setConfigBusy(true);
    try {
      await updateAdminBillingConfig(configTargetKey, parsed.value);
      toast.success(`配置 ${configTargetKey} 已更新`);
      closeConfigDialog(true);
      await configsQuery.refetch();
    } catch (error) {
      setConfigError(publicApiError(error, "更新配置失败"));
    } finally {
      setConfigBusy(false);
    }
  };

  const reload = useCallback(async () => {
    if (!active) return;
    await Promise.allSettled([plansQuery.refetch(), packagesQuery.refetch(), configsQuery.refetch()]);
  }, [active, plansQuery, packagesQuery, configsQuery]);

  return {
    closeConfigDialog,
    closePackageDialog,
    closePlanDialog,
    configBusy,
    configError,
    configMeta,
    configTargetKey,
    configText,
    configs: configsQuery.data || [],
    isError: active && (plansQuery.isError || packagesQuery.isError || configsQuery.isError),
    isPending: active && (plansQuery.isPending || packagesQuery.isPending || configsQuery.isPending),
    openConfigDialog,
    openPackageDialog,
    openPlanDialog,
    packageBusy,
    packageDraft,
    packageErrors,
    packageTarget,
    packages: packagesQuery.data || [],
    planBusy,
    planDraft,
    planErrors,
    planTarget,
    plans: plansQuery.data || [],
    reload,
    setConfigText,
    setPackageDraft,
    setPlanDraft,
    submitConfig,
    submitPackage,
    submitPlan,
  };
}

export type PlansConfigController = ReturnType<typeof usePlansConfigController>;
