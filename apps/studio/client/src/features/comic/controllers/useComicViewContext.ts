import { useCallback, useEffect, useRef } from "react";
import { getAuthToken } from "@/shared/api/http";

// Keep background operations recoverable but prevent their late callbacks
// from changing a different project, account or unmounted view.
export function useComicViewContext() {
  const epoch = useRef(0);
  const requests = useRef(new Map<string, number>());
  useEffect(() => () => { epoch.current++; requests.current.clear(); }, []);
  const captureView = useCallback((channel?: string) => {
    const current = epoch.current;
    const token = getAuthToken();
    const request = channel ? (requests.current.get(channel) || 0) + 1 : 0;
    if (channel) requests.current.set(channel, request);
    return () => epoch.current === current && getAuthToken() === token
      && (!channel || requests.current.get(channel) === request);
  }, []);
  const invalidateView = useCallback(() => { epoch.current++; requests.current.clear(); }, []);
  return { captureView, invalidateView };
}
