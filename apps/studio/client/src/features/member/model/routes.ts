import { Crown, Gift, Package, ReceiptText, Ruler, Wallet } from "lucide-react";

/** 会员中心 6 个用户端页面（image14 左侧导航口径 + WP-M15 礼包超市）。 */
export type MemberTab = "home" | "usage" | "plans" | "gifts" | "invite" | "pricing";

export const memberTabPaths: Record<MemberTab, string> = {
  home: "/member",
  usage: "/member/usage",
  plans: "/member/plans",
  gifts: "/member/gifts",
  invite: "/member/invite",
  pricing: "/member/pricing",
};

export const memberTabs = [
  ["home", "会员中心", Crown],
  ["usage", "积分明细", ReceiptText],
  ["plans", "套餐购买", Wallet],
  ["gifts", "礼包超市", Package],
  ["invite", "邀请有礼", Gift],
  ["pricing", "定价规则", Ruler],
] as const;

export function memberTabFromLocation(pathname: string): MemberTab {
  if (pathname.startsWith("/member/usage")) return "usage";
  if (pathname.startsWith("/member/plans")) return "plans";
  if (pathname.startsWith("/member/gifts")) return "gifts";
  if (pathname.startsWith("/member/invite")) return "invite";
  if (pathname.startsWith("/member/pricing")) return "pricing";
  return "home";
}
