import { lazy, Suspense, type ReactNode } from "react";
import { Route, Switch } from "wouter";

import AuthGuard from "@/components/AuthGuard";
import ErrorBoundary from "@/components/ErrorBoundary";

import { appRoutes, type AppRoute, type RouteLayout } from "./routes";

const StudioLayout = lazy(() => import("../layouts/StudioLayout"));
const CanvasLayout = lazy(() => import("../layouts/CanvasLayout"));
const NotFoundRoute = lazy(() => import("./NotFoundRoute"));

function RouteLoading() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0f1117", color: "#666", fontSize: 13, fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)", gap: 10 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#E9513E", display: "inline-block", opacity: 0.9 }} />
      连接工作区…
    </div>
  );
}

function RouteLayoutBoundary({ layout, children }: { layout: RouteLayout; children: ReactNode }) {
  if (layout === "studio") return <StudioLayout>{children}</StudioLayout>;
  if (layout === "canvas") return <CanvasLayout>{children}</CanvasLayout>;
  return <>{children}</>;
}

function ProtectedRoute({ route, children }: { route: AppRoute; children: ReactNode }) {
  if (route.permission === "public") return <>{children}</>;
  return (
    <AuthGuard requiredRole={route.permission === "super_admin" ? "super_admin" : undefined}>
      {children}
    </AuthGuard>
  );
}

function AppRouteElement({ route }: { route: AppRoute }) {
  const Page = route.Component;
  return (
    <ProtectedRoute route={route}>
      <ErrorBoundary>
        <Suspense fallback={<RouteLoading />}>
          <RouteLayoutBoundary layout={route.layout}>
            <Page />
          </RouteLayoutBoundary>
        </Suspense>
      </ErrorBoundary>
    </ProtectedRoute>
  );
}

export default function AppRouter() {
  return (
    <Switch>
      {appRoutes.map(route => (
        <Route path={route.path} key={route.id}>
          <AppRouteElement route={route} />
        </Route>
      ))}
      <Route>
        <ErrorBoundary>
          <Suspense fallback={<RouteLoading />}>
            <NotFoundRoute />
          </Suspense>
        </ErrorBoundary>
      </Route>
    </Switch>
  );
}
