import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";

import {
  legacyStudioRouteTarget,
  tagDeepLinkTarget,
} from "@/lib/studio-route-aliases";

export function TagDeepLinkRedirect() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  useEffect(() => {
    navigate(tagDeepLinkTarget(location, search, window.location.hash), {
      replace: true,
    });
  }, [location, navigate, search]);
  return null;
}

export function LegacyStudioRouteRedirect() {
  const [location, navigate] = useLocation();
  useEffect(() => {
    const source = location.includes("?")
      ? location
      : `${location}${window.location.search}`;
    const target = legacyStudioRouteTarget(source);
    if (target) navigate(`${target}${window.location.hash}`, { replace: true });
  }, [location, navigate]);
  return null;
}

/* 首页入口：聊天台主页隐藏期间，/ 直接落到工作台（今日片场） */
export function HomeRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/dashboard", { replace: true });
  }, [navigate]);
  return null;
}
