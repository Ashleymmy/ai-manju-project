import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  reportRuntimeError,
  reportRequestFailure,
  setRuntimeErrorOwner,
} from "@/shared/lib/runtimeErrorReport";
import {
  REQUEST_FAILURE_EVENT,
  type RequestFailureDiagnostic,
} from "@/shared/lib/requestDiagnostics";

export function RuntimeErrorReporter() {
  const { user } = useAuth();
  useEffect(() => {
    setRuntimeErrorOwner(user?.id || "");
    const onError = (event: ErrorEvent) =>
      reportRuntimeError(event.error || event.message);
    const onRejection = (event: PromiseRejectionEvent) =>
      reportRuntimeError(event.reason, "unhandled_rejection");
    const onNetwork = (event: Event) => {
      reportRequestFailure(
        (event as CustomEvent<RequestFailureDiagnostic>).detail
      );
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener(REQUEST_FAILURE_EVENT, onNetwork);
    return () => {
      setRuntimeErrorOwner("");
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener(REQUEST_FAILURE_EVENT, onNetwork);
    };
  }, [user?.id]);
  return null;
}
