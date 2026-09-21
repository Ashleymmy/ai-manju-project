/** Keep only the latest crash in this tab, so an intermittent failure survives a reload. */
export const PAGE_ERROR_REPORT_KEY = "ai-manju:last-page-error";
/** Bound each diagnostic field so a large stack cannot exhaust session storage. */
const REPORT_TEXT_LIMIT = 8_000;

export type PageErrorReport = {
  occurredAt: string;
  fromPath: string;
  path: string;
  message: string;
  stack: string;
  componentStack: string;
};

let navigation = { previous: "", current: "" };

export function notePageNavigation(path: string) {
  if (path === navigation.current) return;
  navigation = { previous: navigation.current, current: path };
}

export function savePageError(
  error: Error,
  componentStack: string
): PageErrorReport {
  const path = window.location.pathname;
  const report: PageErrorReport = {
    occurredAt: new Date().toISOString(),
    fromPath:
      path === navigation.current ? navigation.previous : navigation.current,
    path,
    message: String(error?.message || error).slice(0, REPORT_TEXT_LIMIT),
    stack: String(error?.stack || "").slice(0, REPORT_TEXT_LIMIT),
    componentStack: componentStack.slice(0, REPORT_TEXT_LIMIT),
  };
  try {
    window.sessionStorage.setItem(
      PAGE_ERROR_REPORT_KEY,
      JSON.stringify(report)
    );
  } catch {
    /* Recovery still works when storage is unavailable. */
  }
  return report;
}
