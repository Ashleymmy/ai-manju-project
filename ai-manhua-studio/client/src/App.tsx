/**
 * Style reminder: 影印分镜室 — keep navigation persistent and make every route feel like another surface on one director's desk.
 */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import AuthGuard from "@/components/AuthGuard";
import Home from "@/pages/Home";
import { AuthView } from "@/pages/SystemViews";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";

const studioRoutes = [
  "/",
  "/projects",
  "/canvas",
  "/director",
  "/comic-assets",
  "/image",
  "/assets",
  "/tags",
  "/prompts",
  "/queue",
  "/settings",
  "/admin",
];

function ProtectedHome() {
  return (
    <AuthGuard>
      <Home />
    </AuthGuard>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={AuthView} />
      <Route path="/v2-login" component={AuthView} />
      <Route path="/register" component={AuthView} />
      <Route path="/canvas/:id" component={ProtectedHome} />
      {studioRoutes.map((path) => (
        <Route key={path} path={path} component={ProtectedHome} />
      ))}
      <Route component={ProtectedHome} />
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
