/**
 * Style reminder: 影印分镜室 — keep navigation persistent and make every route feel like another surface on one director's desk.
 */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "@/pages/Home";
import { AuthView } from "@/pages/SystemViews";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

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

function Router() {
  return (
    <Switch>
      <Route path="/login" component={AuthView} />
      <Route path="/v2-login" component={AuthView} />
      <Route path="/register" component={AuthView} />
      <Route path="/canvas/:id" component={Home} />
      {studioRoutes.map((path) => (
        <Route key={path} path={path} component={Home} />
      ))}
      <Route component={Home} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster position="bottom-right" theme="dark" richColors />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
