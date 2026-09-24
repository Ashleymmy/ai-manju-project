import { isModuleLoadError } from "@/shared/lib/moduleLoadError";
import { reportRuntimeError } from "@/shared/lib/runtimeErrorReport";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import {
  savePageError,
  type PageErrorReport,
} from "@/shared/lib/pageErrorReport";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  resetKey?: string;
  onGoHome?: () => void;
  contained?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  report?: PageErrorReport;
  copyStatus?: string;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportRuntimeError(error, "render_error", `${error.stack || ""}\n${info.componentStack || ""}`);
    this.setState({
      report: savePageError(error, info.componentStack || ""),
      copyStatus: "",
    });
  }

  componentDidUpdate(previous: Props) {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.retry();
    }
  }

  private retry = () =>
    this.setState({
      hasError: false,
      error: null,
      report: undefined,
      copyStatus: "",
    });

  private copyReport = async () => {
    const result = await copyTextToClipboard(
      JSON.stringify(this.state.report, null, 2) ||
        this.state.error?.message ||
        ""
    );
    this.setState({
      copyStatus:
        result === "copied"
          ? "错误信息已复制"
          : "复制失败，请展开错误详情手动复制",
    });
  };

  render() {
    if (this.state.hasError) {
      const moduleError = isModuleLoadError(this.state.error);
      return (
        <div
          role="alert"
          className={`flex items-center justify-center ${this.props.contained ? "min-h-[50vh]" : "min-h-screen"} p-8 bg-background`}
        >
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-4">
              {moduleError ? "页面暂时未能加载" : "页面遇到异常"}
            </h2>

            <p className="text-sm text-muted-foreground mb-6">
              {moduleError
                ? "网络连接中断或页面版本已更新，请重新加载。"
                : "可以重试此页面，或先切换到其他页面继续使用。"}
            </p>
            <details className="p-4 w-full rounded bg-muted overflow-auto mb-6">
              <summary>错误详情</summary>
              <pre className="max-h-64 overflow-auto text-sm text-muted-foreground whitespace-break-spaces">
                {JSON.stringify(this.state.report, null, 2) ||
                  this.state.error?.message}
              </pre>
            </details>

            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={
                  moduleError ? () => window.location.reload() : this.retry
                }
                type="button"
                className="flex items-center gap-2 px-4 py-2 rounded-lg hover:opacity-90 cursor-pointer"
                style={{ background: "#f2f1ee", color: "#171717" }}
              >
                <RotateCcw size={16} />
                {moduleError ? "重新加载" : "重试此页面"}
              </button>
              {this.props.onGoHome && (
                <button
                  type="button"
                  className="px-4 py-2 rounded border cursor-pointer"
                  onClick={this.props.onGoHome}
                >
                  返回工作台
                </button>
              )}
              <button
                type="button"
                className="px-4 py-2 rounded border cursor-pointer"
                onClick={() => void this.copyReport()}
              >
                复制错误信息
              </button>
            </div>
            {this.state.copyStatus && (
              <p role="status" className="text-sm mt-4">
                {this.state.copyStatus}
              </p>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
