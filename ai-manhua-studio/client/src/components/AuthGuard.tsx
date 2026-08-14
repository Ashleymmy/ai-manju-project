import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

export default function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && !user) navigate("/login");
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "#0f1117",
        color: "#666", fontSize: 13, fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
        gap: 10,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", background: "#E9513E",
          display: "inline-block", opacity: 0.9,
        }} />
        连接工作区…
      </div>
    );
  }

  if (!user) return null;
  return <>{children}</>;
}
