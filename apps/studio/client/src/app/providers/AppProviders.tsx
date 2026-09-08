import type { ReactNode } from "react";

import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

import { QueryProvider } from "./QueryProvider";

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ErrorBoundary>
        <ThemeProvider defaultTheme="dark">
          <AuthProvider>
            <TooltipProvider>
              {/* 成功提示放顶部居中，避免挡住画布右下角内容 */}
              <Toaster position="top-center" theme="dark" richColors />
              {children}
            </TooltipProvider>
          </AuthProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </QueryProvider>
  );
}
