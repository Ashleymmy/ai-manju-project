import { lazy, Suspense, type ReactNode } from "react";
import { Route, Switch, useLocation } from "wouter";

import AuthGuard from "@/components/AuthGuard";
import ErrorBoundary from "@/components/ErrorBoundary";
import PageLoader from "@/components/PageLoader";

import { appRoutes, type AppRoute, type RouteLayout } from "./routes";
import { loadRouteModule } from "./loadRouteModule";

const StudioLayout = lazy(() => loadRouteModule(() => import("../layouts/StudioLayout")));
const CanvasLayout = lazy(() => loadRouteModule(() => import("../layouts/CanvasLayout")));
const NotFoundRoute = lazy(() => loadRouteModule(() => import("./NotFoundRoute")));

function RouteLoading() {
  return <PageLoader />;
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
  const [location] = useLocation();
  const Page = route.Component;
  return (
    <ProtectedRoute route={route}>
      <ErrorBoundary resetKey={`${route.id}:${location}`}>
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
