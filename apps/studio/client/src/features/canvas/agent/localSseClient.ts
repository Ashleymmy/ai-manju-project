import {
  CANVAS_AGENT_PROTOCOL_VERSION,
  isCanvasAgentToolName,
  type CanvasAgentSnapshot,
  type CanvasAgentToolRequest,
} from "@/lib/canvas-agent";

export type LocalAgentEvent = {
  type?: string;
  thread_id?: string;
  item?: { id?: string; type?: string; text?: string };
};

export type LocalAgentSseCallbacks = {
  getSnapshot: () => CanvasAgentSnapshot;
  onHello: () => void;
  onToolCall: (request: CanvasAgentToolRequest) => void;
  onAgentEvent: (event: LocalAgentEvent) => void;
  onDone: () => void;
  onAgentError: (message: string) => void;
  onConnectionError: (wasConnected: boolean) => void;
  onDispose?: () => void;
};

export type LocalAgentEventSource = Pick<
  EventSource,
  "addEventListener" | "close" | "onerror"
>;

export type LocalAgentClientServices = {
  createEventSource: (url: string) => LocalAgentEventSource;
  fetch: typeof fetch;
};

const browserServices: LocalAgentClientServices = {
  createEventSource: url => new EventSource(url),
  fetch: (...args) => fetch(...args),
};

export function normalizeLocalAgentEndpoint(url: string) {
  return url.trim().replace(/\/$/, "");
}

export function createLocalAgentSseClient(
  input: {
    endpoint: string;
    token: string;
    clientId: string;
    callbacks: LocalAgentSseCallbacks;
  },
  services: LocalAgentClientServices = browserServices,
) {
  const endpoint = normalizeLocalAgentEndpoint(input.endpoint);
  const { token, clientId, callbacks } = input;
  let wasConnected = false;
  const source = services.createEventSource(
    `${endpoint}/events?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`,
  );

  source.addEventListener("hello", () => {
    wasConnected = true;
    callbacks.onHello();
    void postLocalAgentState(
      endpoint,
      token,
      clientId,
      callbacks.getSnapshot(),
      services,
    );
  });
  source.addEventListener("tool_call", event => {
    const request = parseLocalAgentEvent<CanvasAgentToolRequest>(event);
    if (!request?.requestId) return;
    if (isCanvasAgentToolName(request.name)) {
      callbacks.onToolCall(request);
      return;
    }
    void postLocalAgentResult(
      endpoint,
      token,
      clientId,
      {
        requestId: request.requestId,
        error: `不支持的工具：${String(request.name || "unknown")}`,
      },
      services,
    ).catch(() => undefined);
  });
  source.addEventListener("agent_event", event => {
    const data = parseLocalAgentEvent<LocalAgentEvent>(event);
    if (data) callbacks.onAgentEvent(data);
  });
  source.addEventListener("agent_done", callbacks.onDone);
  source.addEventListener("agent_error", event => {
    callbacks.onAgentError(
      parseLocalAgentEvent<{ message?: string }>(event)?.message ?? "Agent 出错",
    );
  });
  source.onerror = () => {
    const connectedBeforeError = wasConnected;
    wasConnected = false;
    callbacks.onConnectionError(connectedBeforeError);
    if (!connectedBeforeError) source.close();
  };

  return {
    close() {
      source.close();
      wasConnected = false;
      callbacks.onDispose?.();
    },
  };
}

export async function sendLocalAgentTurn(
  endpoint: string,
  token: string,
  input: { prompt: string; canvasId: string; threadId?: string },
  services: Pick<LocalAgentClientServices, "fetch"> = browserServices,
) {
  const response = await services.fetch(
    `${normalizeLocalAgentEndpoint(endpoint)}/agent/codex/turn?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) throw new Error("请求被拒绝");
  return response.json() as Promise<{ threadId?: string }>;
}

export async function postLocalAgentState(
  endpoint: string,
  token: string,
  clientId: string,
  snapshot: CanvasAgentSnapshot,
  services: Pick<LocalAgentClientServices, "fetch"> = browserServices,
) {
  try {
    await services.fetch(
      `${normalizeLocalAgentEndpoint(endpoint)}/canvas/state?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...snapshot,
          protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION,
        }),
      },
    );
  } catch {
    // SSE 会负责呈现连接状态，快照同步失败时等待下一轮 300ms 同步。
  }
}

export async function postLocalAgentResult(
  endpoint: string,
  token: string,
  clientId: string,
  body: { requestId: string; result?: unknown; error?: string },
  services: Pick<LocalAgentClientServices, "fetch"> = browserServices,
) {
  const response = await services.fetch(
    `${normalizeLocalAgentEndpoint(endpoint)}/canvas/result?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...body,
        protocolVersion: CANVAS_AGENT_PROTOCOL_VERSION,
      }),
    },
  );
  if (!response.ok) throw new Error("本地 Agent 未接收工具结果");
}

export function parseLocalAgentEvent<T>(event: Event) {
  try {
    return JSON.parse((event as MessageEvent).data) as T;
  } catch {
    return null;
  }
}
