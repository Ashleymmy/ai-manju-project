import { useLocation } from "wouter";

import { useGiftsController } from "./controllers/useGiftsController";
import { useInviteController } from "./controllers/useInviteController";
import { useMemberOverviewQuery } from "./controllers/useMemberOverview";
import { usePlansController } from "./controllers/usePlansController";
import { usePricingQuery } from "./controllers/usePricing";
import { useUsageController } from "./controllers/useUsageController";
import { memberTabFromLocation, memberTabPaths, memberTabs } from "./model/routes";
import { GiftPackView } from "./ui/GiftPackView";
import { InviteView } from "./ui/InviteView";
import { MemberHomeView } from "./ui/MemberHomeView";
import { PlansView } from "./ui/PlansView";
import { PricingRulesView } from "./ui/PricingRulesView";
import { UsageDetailView } from "./ui/UsageDetailView";

import "./styles.css";

const TAB_TITLES: Record<string, { eyebrow: string; title: string; description: string }> = {
  home: { eyebrow: "MEMBER / HOME", title: "会员中心", description: "会员状态、双余额与本月消耗一目了然。" },
  usage: { eyebrow: "MEMBER / USAGE", title: "积分明细", description: "每一次扣费与每一笔流水都可追溯。" },
  plans: { eyebrow: "MEMBER / PLANS", title: "套餐购买", description: "订阅会员享每月积分与折扣，也可直接购买永久积分。" },
  gifts: { eyebrow: "MEMBER / GIFTS", title: "礼包超市", description: "运营配置驱动的礼包货架，内容陆续上架。" },
  invite: { eyebrow: "MEMBER / INVITE", title: "邀请有礼", description: "邀请好友注册与首充，双方都得积分奖励。" },
  pricing: { eyebrow: "MEMBER / PRICING", title: "定价规则", description: "积分兑换基准、扣费优先级与各类型生成单价。" },
};

export default function MemberPage() {
  const [location, navigate] = useLocation();
  const tab = memberTabFromLocation(location.split("?")[0]);
  const titles = TAB_TITLES[tab];

  const overviewQuery = useMemberOverviewQuery(tab === "home");
  const usageController = useUsageController(tab === "usage");
  const plansController = usePlansController(tab === "plans");
  const giftsController = useGiftsController(tab === "gifts");
  const inviteController = useInviteController(tab === "invite");
  const pricingQuery = usePricingQuery(tab === "pricing");

  return (
    <div className="feature-page member-page">
      <div className="feature-title">
        <div>
          <p className="eyebrow">{titles.eyebrow}</p>
          <h1>{titles.title}</h1>
          <p>{titles.description}</p>
        </div>
      </div>
      <div className="member-workspace">
        <aside className="member-nav">
          {memberTabs.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              className={tab === key ? "selected" : ""}
              onClick={() => navigate(memberTabPaths[key])}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </aside>
        <section className="member-panel">
          {tab === "home" ? <MemberHomeView overviewQuery={overviewQuery} /> : null}
          {tab === "usage" ? <UsageDetailView controller={usageController} /> : null}
          {tab === "plans" ? <PlansView controller={plansController} /> : null}
          {tab === "gifts" ? <GiftPackView controller={giftsController} /> : null}
          {tab === "invite" ? <InviteView controller={inviteController} /> : null}
          {tab === "pricing" ? <PricingRulesView pricingQuery={pricingQuery} /> : null}
        </section>
      </div>
    </div>
  );
}
