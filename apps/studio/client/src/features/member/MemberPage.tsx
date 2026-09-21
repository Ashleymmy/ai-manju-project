import { useEffect } from "react";
import { useLocation } from "wouter";
import { X } from "lucide-react";

import { ProfileView } from "@/features/profile";

import { useGiftsController } from "./controllers/useGiftsController";
import { useInviteController } from "./controllers/useInviteController";
import { useMemberOverviewQuery } from "./controllers/useMemberOverview";
import { usePlansController } from "./controllers/usePlansController";
import { usePricingQuery } from "./controllers/usePricing";
import { useUsageController } from "./controllers/useUsageController";
import { memberTabFromLocation, memberTabGroups, memberTabPaths } from "./model/routes";
import { GiftPackView } from "./ui/GiftPackView";
import { InviteView } from "./ui/InviteView";
import { MemberHomeView } from "./ui/MemberHomeView";
import { PlansView } from "./ui/PlansView";
import { PricingRulesView } from "./ui/PricingRulesView";
import { UsageDetailView } from "./ui/UsageDetailView";

import "./styles.css";

/** 弹窗关闭后的落点：会员中心不是独立页面而是覆盖层，关掉回到工作台。 */
const MEMBER_DIALOG_CLOSE_TARGET = "/dashboard";

const TAB_TITLES: Record<string, { title: string; description: string }> = {
  home: { title: "会员中心", description: "查看您的会员权益与积分余额" },
  usage: { title: "积分明细", description: "每一次扣费与每一笔流水都可追溯" },
  plans: { title: "套餐购买", description: "选择适合您的积分套餐或会员方案" },
  gifts: { title: "礼包超市", description: "运营配置驱动的礼包货架，内容陆续上架" },
  invite: { title: "邀请有礼", description: "邀请好友注册与首充，双方都得积分奖励" },
  pricing: { title: "定价规则", description: "透明计费，用多少扣多少" },
  profile: { title: "个人主页", description: "把常用模型、提示词预设和工作区状态集中放在一个页面里" },
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

  // Esc 关闭弹窗（与 TapNow 设置弹窗一致：右上角 X + Esc 两种退出方式）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        navigate(MEMBER_DIALOG_CLOSE_TARGET);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return (
    <div className="member-page member-overlay" role="dialog" aria-modal="true" aria-label="会员中心">
      <div className="member-dialog">
        <button
          type="button"
          className="member-dialog-close"
          onClick={() => navigate(MEMBER_DIALOG_CLOSE_TARGET)}
          aria-label="关闭会员中心"
        >
          <X size={16} />
        </button>
        <aside className="member-nav">
          {memberTabGroups.map(group => (
            <div className="member-nav-group" key={group.label}>
              <p className="member-nav-label">{group.label}</p>
              {group.tabs.map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  className={tab === key ? "selected" : ""}
                  onClick={() => navigate(memberTabPaths[key])}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>
          ))}
        </aside>
        <section className="member-panel">
          <header className="member-panel-head">
            <h3>{titles.title}</h3>
            <p>{titles.description}</p>
          </header>
          <div className="member-panel-body">
            {tab === "home" ? <MemberHomeView overviewQuery={overviewQuery} /> : null}
            {tab === "usage" ? <UsageDetailView controller={usageController} /> : null}
            {tab === "plans" ? <PlansView controller={plansController} /> : null}
            {tab === "gifts" ? <GiftPackView controller={giftsController} /> : null}
            {tab === "invite" ? <InviteView controller={inviteController} /> : null}
            {tab === "pricing" ? <PricingRulesView pricingQuery={pricingQuery} /> : null}
            {tab === "profile" ? <ProfileView embedded /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
