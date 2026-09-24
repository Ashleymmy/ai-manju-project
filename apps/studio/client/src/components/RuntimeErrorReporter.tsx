import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  reportRuntimeError,
  setRuntimeErrorOwner,
} from "@/shared/lib/runtimeErrorReport";

export function RuntimeErrorReporter() {
  const { user } = useAuth();
  useEffect(() => {
    setRuntimeErrorOwner(user?.id || "");
    const onError = (event: ErrorEvent) =>
      reportRuntimeError(event.error || event.message);
    const onRejection = (event: PromiseRejectionEvent) =>
      reportRuntimeError(event.reason, "unhandled_rejection");
    const onNetwork = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          message: string;
          path: string;
          requestId: string;
        }>
      ).detail;
      reportRuntimeError(
        `${detail.message}: ${detail.path}`,
        "network_error",
        `Request ID: ${detail.requestId}`
      );
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("ai-manju:network-error", onNetwork);
    return () => {
      setRuntimeErrorOwner("");
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("ai-manju:network-error", onNetwork);
    };
  }, [user?.id]);
  return null;
}
