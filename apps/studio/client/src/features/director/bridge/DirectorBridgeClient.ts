import {
  DIRECTOR_PROTOCOL_VERSION,
  DIRECTOR_READY_TYPE,
  DIRECTOR_REQUEST_TYPE,
  DIRECTOR_RESPONSE_TYPE,
  DIRECTOR_SESSION_TYPE,
  isDirectorResponse,
  type DirectorAction,
  type DirectorResponse,
} from "../model/protocol";

export const DIRECTOR_REQUEST_TIMEOUT_MS = 20_000;
export const DIRECTOR_VIDEO_REQUEST_TIMEOUT_MS = 60_000;

export type DirectorMessageTarget = {
  postMessage(message: unknown, targetOrigin: string): void;
};

export type DirectorMessageEvent = {
  origin: string;
  source: unknown;
  data: unknown;
};

export type DirectorBridgeEnvironment = {
  origin: string;
  addMessageListener(
    listener: (event: DirectorMessageEvent) => void
  ): () => void;
  setTimer(callback: () => void, delay: number): number;
  clearTimer(timer: number): void;
};

export type DirectorBridgeCallbacks = {
  onReady(): void;
  onCapabilities(data: unknown): void;
};

type PendingRequest = {
  action: DirectorAction;
  reject: (error: Error) => void;
  resolve: (response: DirectorResponse) => void;
  timeout: number;
};

export function createBrowserDirectorBridgeEnvironment(
  hostWindow: Window
): DirectorBridgeEnvironment {
  return {
    origin: hostWindow.location.origin,
    addMessageListener(listener) {
      const handleMessage = (event: MessageEvent) => listener(event);
      hostWindow.addEventListener("message", handleMessage);
      return () => hostWindow.removeEventListener("message", handleMessage);
    },
    setTimer: (callback, delay) => hostWindow.setTimeout(callback, delay),
    clearTimer: timer => hostWindow.clearTimeout(timer),
  };
}

export class DirectorBridgeClient {
  private readonly pending = new Map<string, PendingRequest>();
  private removeMessageListener: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly input: {
      environment: DirectorBridgeEnvironment;
      getTarget: () => DirectorMessageTarget | null;
      instanceId: string;
      callbacks: DirectorBridgeCallbacks;
      createRequestId?: () => string;
    }
  ) {}

  start() {
    if (this.removeMessageListener || this.disposed) return;
    this.removeMessageListener = this.input.environment.addMessageListener(
      event => this.handleMessage(event)
    );
  }

  request(
    action: DirectorAction,
    options?: Record<string, unknown>
  ): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error("导演台 iframe 已关闭"));
    const target = this.input.getTarget();
    if (!target) return Promise.reject(new Error("导演台 iframe 尚未准备好"));
    const requestId = this.input.createRequestId?.() || crypto.randomUUID();

    return new Promise<unknown>((resolve, reject) => {
      const timeout = this.input.environment.setTimer(
        () => {
          this.pending.delete(requestId);
          reject(new Error(`导演台请求超时：${action}`));
        },
        action === "export.video"
          ? DIRECTOR_VIDEO_REQUEST_TIMEOUT_MS
          : DIRECTOR_REQUEST_TIMEOUT_MS
      );
      this.pending.set(requestId, {
        action,
        timeout,
        reject,
        resolve: response =>
          response.ok
            ? resolve(response.data)
            : reject(new Error(response.error?.message || "导演台请求失败")),
      });

      try {
        target.postMessage(
          {
            type: DIRECTOR_REQUEST_TYPE,
            payload: {
              requestId,
              action,
              ...(options ? { options } : {}),
            },
          },
          this.input.environment.origin
        );
      } catch (error) {
        this.input.environment.clearTimer(timeout);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error("导演台请求失败"));
      }
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.removeMessageListener?.();
    this.removeMessageListener = null;
    this.pending.forEach(pending => {
      this.input.environment.clearTimer(pending.timeout);
      pending.reject(new Error("导演台 iframe 已关闭"));
    });
    this.pending.clear();
  }

  private handleMessage(event: DirectorMessageEvent) {
    const target = this.input.getTarget();
    if (
      event.origin !== this.input.environment.origin ||
      !target ||
      event.source !== target
    ) {
      return;
    }

    if (isMessageType(event.data, DIRECTOR_READY_TYPE)) {
      target.postMessage(
        {
          type: DIRECTOR_SESSION_TYPE,
          payload: { instanceId: this.input.instanceId, theme: "dark" },
        },
        this.input.environment.origin
      );
      this.input.callbacks.onReady();
      void this.request("capabilities.get")
        .then(data => this.input.callbacks.onCapabilities(data))
        .catch(() => undefined);
      return;
    }

    if (!isMessageType(event.data, DIRECTOR_RESPONSE_TYPE)) return;
    const response = event.data.payload;
    if (!isDirectorResponse(response)) return;
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.input.environment.clearTimer(pending.timeout);
    this.pending.delete(response.requestId);
    if (response.action !== pending.action) {
      pending.reject(
        new Error(
          `导演台响应操作不匹配：${pending.action} / ${response.action}`
        )
      );
      return;
    }
    pending.resolve(response);
  }
}

function isMessageType(
  value: unknown,
  type: string
): value is { type: string; payload?: unknown } {
  return Boolean(
    value && typeof value === "object" && "type" in value && value.type === type
  );
}
