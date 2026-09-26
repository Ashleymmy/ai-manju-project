import { useCallback, useEffect, useRef } from "react";
import { getAuthToken } from "@/shared/api/http";

// Keep background operations recoverable but prevent their late callbacks
// from changing a different project, account or unmounted view.
export function useComicViewContext() {
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current++; }, []);
  const captureView = useCallback(() => {
    const current = epoch.current;
    const token = getAuthToken();
    return () => epoch.current === current && getAuthToken() === token;
  }, []);
  const invalidateView = useCallback(() => { epoch.current++; }, []);
  return { captureView, invalidateView };
}
