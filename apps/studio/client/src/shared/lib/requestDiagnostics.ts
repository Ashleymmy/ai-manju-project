/** Facts captured at the failing request, before a public error replaces it. */
export type RequestFailureDiagnostic = {
  message: string;
  path: string;
  method: string;
  requestId: string;
  httpStatus: number;
  durationMs: number;
  diagnostics: {
    stage:
      | "request_timeout"
      | "request_transport"
      | "response_read"
      | "gateway_response";
    page_path: string;
    exception_name: string;
    exception_message: string;
    stack: string;
    timeout_ms: number;
    response_received: boolean;
    online?: boolean;
    response_body?: string;
  };
};
export const REQUEST_FAILURE_EVENT = "ai-manju:network-error";
/** Bounded gateway excerpt; request bodies and headers are never collected. */
export const RESPONSE_DIAGNOSTIC_LIMIT = 4000;
