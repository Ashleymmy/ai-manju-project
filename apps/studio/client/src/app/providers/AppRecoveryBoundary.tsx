import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import ErrorBoundary from "@/components/ErrorBoundary";
import { notePageNavigation } from "@/shared/lib/pageErrorReport";

/** The outer boundary must also recover if a page throws while being unmounted. */
export default function AppRecoveryBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const [path, navigate] = useLocation();
  useEffect(() => notePageNavigation(path), [path]);
  return (
    <ErrorBoundary resetKey={path} onGoHome={() => navigate("/dashboard")}>
      {children}
    </ErrorBoundary>
  );
}
