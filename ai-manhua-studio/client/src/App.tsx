/**
 * Style reminder: 影印分镜室 — keep navigation persistent and make every route feel like another surface on one director's desk.
 */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import AuthGuard from "@/components/AuthGuard";
import CanvasWorkspaceView from "@/pages/CanvasWorkspaceView";
import ChatView from "@/pages/ChatView";
import Home from "@/pages/Home";
import { AuthView } from "@/pages/SystemViews";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation, useSearch } from "wouter";
import { useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import { legacyStudioRoutePaths, legacyStudioRouteTarget, tagDeepLinkTarget } from "./lib/studio-route-aliases";

// 注："/" 已作为首次进入的聊天界面（ChatView），不再归属 Home 工作台路由组
const studioRoutes = [
  "/projects",
  "/canvas",
  "/director",
  "/comic-assets",
  "/image",
  "/video",
  "/assets",
  "/tags",
  "/prompts",
  "/profile",
  "/queue",
  "/settings",
];

function ProtectedHome() {
  return (
    <AuthGuard>
      <Home />
    </AuthGuard>
  );
}

function ProtectedAdminHome() {
  return (
    <AuthGuard requiredRole="super_admin">
      <Home />
    </AuthGuard>
  );
}

function ProtectedCanvasHome() {
  return (
    <AuthGuard>
      <div className="studio-app canvas-focus canvas-focus-direct">
        <main className="main-stage">
          <CanvasWorkspaceView />
        </main>
      </div>
    </AuthGuard>
  );
}

function ProtectedTagDeepLink() {
  return (
    <AuthGuard>
      <TagDeepLinkRedirect />
    </AuthGuard>
  );
}

function TagDeepLinkRedirect() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  useEffect(() => {
    navigate(tagDeepLinkTarget(location, search), { replace: true });
  }, [location, navigate, search]);
  return null;
}

function LegacyStudioRouteRedirect() {
  const [location, navigate] = useLocation();
  useEffect(() => {
    const source = location.includes("?") ? location : `${location}${window.location.search}`;
    const target = legacyStudioRouteTarget(source);
    if (target) navigate(`${target}${window.location.hash}`, { replace: true });
  }, [location, navigate]);
  return null;
}

const adminRoutes = [
  "/admin",
  "/admin/users",
  "/admin/model-provider",
  "/admin/announcements",
  "/admin/seedance-assets",
];

function Router() {
  return (
    <Switch>
      <Route path="/login" component={AuthView} />
      <Route path="/v2-login" component={AuthView} />
      <Route path="/register" component={AuthView} />
      {/* 首次进入的聊天界面：/ 与 /chat 均落地 ChatView（页内自行处理未登录引导） */}
      <Route path="/" component={ChatView} />
      <Route path="/chat" component={ChatView} />
      <Route path="/v2-canvas/:id" component={LegacyStudioRouteRedirect} />
      {legacyStudioRoutePaths.map((path) => (
        <Route key={path} path={path} component={LegacyStudioRouteRedirect} />
      ))}
      <Route path="/tags/:tagId" component={ProtectedTagDeepLink} />
      <Route path="/canvas/:id" component={ProtectedCanvasHome} />
      <Route path="/canvas" component={ProtectedCanvasHome} />
      {adminRoutes.map((path) => (
        <Route key={path} path={path} component={ProtectedAdminHome} />
      ))}
      {studioRoutes.map((path) => (
        <Route key={path} path={path} component={ProtectedHome} />
      ))}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <AuthProvider>
          <TooltipProvider>
            <Toaster position="bottom-right" theme="dark" richColors />
            <Router />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
