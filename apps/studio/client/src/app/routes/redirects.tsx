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
