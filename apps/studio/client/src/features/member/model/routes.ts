import { Crown, Gift, Package, ReceiptText, Ruler, UserRound, Wallet } from "lucide-react";

/** 账号中心弹窗的 tab 集合：会员中心 6 页 + 个人主页（从侧边导航迁入，/profile 深链保留）。 */
export type MemberTab = "home" | "usage" | "plans" | "gifts" | "invite" | "pricing" | "profile";

export const memberTabPaths: Record<MemberTab, string> = {
  home: "/member",
  usage: "/member/usage",
  plans: "/member/plans",
  gifts: "/member/gifts",
  invite: "/member/invite",
  pricing: "/member/pricing",
  profile: "/profile",
};

export const memberTabs = [
  ["home", "会员中心", Crown],
  ["usage", "积分明细", ReceiptText],
  ["plans", "套餐购买", Wallet],
  ["gifts", "礼包超市", Package],
  ["invite", "邀请有礼", Gift],
  ["pricing", "定价规则", Ruler],
  ["profile", "个人主页", UserRound],
] as const;

/** 弹窗左侧分组导航（TapNow 设置弹窗口径：分组的组名只做展示，不参与路由）。 */
export const memberTabGroups: { label: string; tabs: readonly (readonly [MemberTab, string, typeof Crown])[] }[] = [
  {
    label: "会员与账单",
    tabs: [
      ["home", "会员中心", Crown],
      ["usage", "积分明细", ReceiptText],
      ["invite", "邀请有礼", Gift],
    ],
  },
  {
    label: "订阅和充值",
    tabs: [
      ["plans", "套餐购买", Wallet],
      ["gifts", "礼包超市", Package],
    ],
  },
  {
    label: "通用设置",
    tabs: [
      ["profile", "个人主页", UserRound],
      ["pricing", "定价规则", Ruler],
    ],
  },
];

export function memberTabFromLocation(pathname: string): MemberTab {
  if (pathname.startsWith("/profile")) return "profile";
  if (pathname.startsWith("/member/usage")) return "usage";
  if (pathname.startsWith("/member/plans")) return "plans";
  if (pathname.startsWith("/member/gifts")) return "gifts";
  if (pathname.startsWith("/member/invite")) return "invite";
  if (pathname.startsWith("/member/pricing")) return "pricing";
  return "home";
}
