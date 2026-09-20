import { isModuleLoadError } from "@/shared/lib/moduleLoadError";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidUpdate(previous: Props) {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      const moduleError = isModuleLoadError(this.state.error);
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-4">{moduleError ? "页面暂时未能加载" : "页面遇到异常"}</h2>

            <p className="text-sm text-muted-foreground mb-6">
              {moduleError ? "网络连接中断或页面版本已更新，请重新加载。" : "请重新加载页面后再试。"}
            </p>
            {import.meta.env.DEV && (
              <details className="p-4 w-full rounded bg-muted overflow-auto mb-6">
                <summary>错误详情</summary>
                <pre className="text-sm text-muted-foreground whitespace-break-spaces">{this.state.error?.stack}</pre>
              </details>
            )}

            <button
              onClick={() => window.location.reload()}
              type="button"
              className="flex items-center gap-2 px-4 py-2 rounded-lg hover:opacity-90 cursor-pointer"
              style={{ background: "#f2f1ee", color: "#171717" }}
            >
              <RotateCcw size={16} />
              重新加载
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
