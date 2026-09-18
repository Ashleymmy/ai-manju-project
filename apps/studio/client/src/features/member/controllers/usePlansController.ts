import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { publicApiError } from "@/shared/api/errors";

import {
  CREDITS_PER_YUAN_FALLBACK,
  DISCOUNT_BPS_FULL,
  PAY_CHANNELS,
  RECHARGE_SLIDER_MAX,
  RECHARGE_SLIDER_MIN,
} from "../model/constants";
import { discountedCents } from "../model/format";
import { memberQueryKeys } from "../model/queryKeys";
import type { BillingOrder, MembershipPlan } from "../model/types";
import { cancelBillingOrder, createBillingOrder, fetchMemberPricing, mockPayOrder } from "../services/memberApi";
import { useInvalidateMemberData, useMemberOverviewQuery } from "./useMemberOverview";

export type PlanPeriod = "month" | "year";

function clampCredits(value: number) {
  if (!Number.isFinite(value)) return RECHARGE_SLIDER_MIN;
  return Math.min(RECHARGE_SLIDER_MAX, Math.max(RECHARGE_SLIDER_MIN, Math.round(value)));
}

/**
 * 套餐购买页控制器：订阅（月付/年付）+ 直购积分（滑杆/预设 + 实时结算）+
 * 下单 → mock 支付/取消 的完整闭环。价格一律以后端 cents 为准。
 */
export function usePlansController(active = true) {
  const pricingQuery = useQuery({
    queryKey: memberQueryKeys.pricing(),
    queryFn: fetchMemberPricing,
    placeholderData: previous => previous,
    enabled: active,
  });
  const overviewQuery = useMemberOverviewQuery(active);
  const invalidateMemberData = useInvalidateMemberData();

  const [period, setPeriod] = useState<PlanPeriod>("month");
  const [credits, setCredits] = useState(3_000);
  const [channel, setChannel] = useState<string>(
    () => PAY_CHANNELS.find(item => item.enabled)?.value || "",
  );
  const [busy, setBusy] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<BillingOrder | null>(null);
  /** 倒计时横幅每秒刷新一次。 */
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const plans = useMemo(
    () => (pricingQuery.data?.plans || []).filter(plan => plan.enabled),
    [pricingQuery.data?.plans],
  );
  const packages = useMemo(
    () =>
      [...(pricingQuery.data?.packages || [])]
        .filter(pkg => pkg.enabled)
        .sort((left, right) => left.sort_order - right.sort_order || left.credits - right.credits),
    [pricingQuery.data?.packages],
  );
  const activity = pricingQuery.data?.activity;
  const creditsPerYuan = pricingQuery.data?.credits_per_yuan || CREDITS_PER_YUAN_FALLBACK;

  /** 当前会员档位（用于直购折扣动态计算）。 */
  const activePlan: MembershipPlan | null = useMemo(() => {
    const code = overviewQuery.data?.membership?.plan_code;
    return code ? plans.find(plan => plan.code === code) || null : null;
  }, [overviewQuery.data?.membership?.plan_code, plans]);
  const memberDiscountBps = activePlan?.credit_discount_bps || DISCOUNT_BPS_FULL;

  /** 直购实时结算：金额 = 积分 / 汇率，再乘会员折扣（与后端 CreateOrder 口径一致）。 */
  const rechargeBaseCents = Math.round((clampCredits(credits) / creditsPerYuan) * 100);
  const rechargePayCents = discountedCents(rechargeBaseCents, memberDiscountBps);
  /** 滑杆金额命中已上架积分包时才允许下单（后端仅接受固定 package_id）。 */
  const matchedPackage = packages.find(pkg => pkg.credits === clampCredits(credits)) || null;

  const placeOrder = async (target: { kind: "plan"; plan: MembershipPlan } | { kind: "credits" }) => {
    if (busy || !channel) return;
    setBusy(true);
    try {
      let created;
      if (target.kind === "credits") {
        if (!matchedPackage) {
          toast.error("当前仅支持已上架积分包档位，请点选上方预设档位");
          return;
        }
        created = await createBillingOrder({ package_id: matchedPackage.id, pay_channel: channel });
      } else {
        created = await createBillingOrder({ plan_id: target.plan.id, period, pay_channel: channel });
      }
      setPendingOrder(created.order);
      toast.success(`订单已创建：${created.order.id}`);
    } catch (error) {
      toast.error(publicApiError(error, "下单失败"));
    } finally {
      setBusy(false);
    }
  };

  const payPendingOrder = async () => {
    if (!pendingOrder || busy) return;
    setBusy(true);
    try {
      await mockPayOrder(pendingOrder.id);
      toast.success("支付成功，积分/会员已到账");
      setPendingOrder(null);
      await invalidateMemberData();
    } catch (error) {
      toast.error(publicApiError(error, "支付失败"));
    } finally {
      setBusy(false);
    }
  };

  const cancelPendingOrder = async () => {
    if (!pendingOrder || busy) return;
    setBusy(true);
    try {
      await cancelBillingOrder(pendingOrder.id);
      toast.success("订单已取消");
      setPendingOrder(null);
      await invalidateMemberData();
    } catch (error) {
      toast.error(publicApiError(error, "取消订单失败"));
    } finally {
      setBusy(false);
    }
  };

  return {
    activePlan,
    activity,
    busy,
    cancelPendingOrder,
    channel,
    credits: clampCredits(credits),
    creditsPerYuan,
    isError: pricingQuery.isError,
    isPending: pricingQuery.isPending,
    matchedPackage,
    memberDiscountBps,
    membership: overviewQuery.data?.membership ?? null,
    nowMs,
    packages,
    payPendingOrder,
    pendingOrder,
    period,
    placeOrder,
    plans,
    rechargeBaseCents,
    rechargePayCents,
    reload: () => void pricingQuery.refetch(),
    setChannel,
    setCredits: (value: number) => setCredits(clampCredits(value)),
    setPeriod,
  };
}

export type PlansController = ReturnType<typeof usePlansController>;
