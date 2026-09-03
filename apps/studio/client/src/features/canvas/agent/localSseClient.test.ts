import { describe, expect, it, vi } from "vitest";

import type { CanvasAgentSnapshot } from "@/lib/canvas-agent";

import {
  createLocalAgentSseClient,
  type LocalAgentClientServices,
} from "./localSseClient";

type Listener = (event: Event) => void;

class FakeEventSource {
  readonly listeners = new Map<string, Listener[]>();
  readonly close = vi.fn();
  onerror: ((event: Event) => void) | null = null;

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) {
    const callback: Listener = typeof listener === "function"
      ? listener
      : event => listener.handleEvent(event);
    this.listeners.set(type, [...(this.listeners.get(type) || []), callback]);
  }

  emit(type: string, data?: unknown) {
    const event = { data: data === undefined ? "" : JSON.stringify(data) } as Event;
    this.listeners.get(type)?.forEach(listener => listener(event));
  }
}

const snapshot: CanvasAgentSnapshot = {
  projectId: "project",
  title: "画布",
  nodes: [],
  connections: [],
  selectedNodeIds: [],
  viewport: { x: 0, y: 0, k: 1 },
};

function setup() {
  const source = new FakeEventSource();
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  const services: LocalAgentClientServices = {
    createEventSource: vi.fn(() => source),
    fetch: fetchMock as typeof fetch,
  };
  const callbacks = {
    getSnapshot: vi.fn(() => snapshot),
    onHello: vi.fn(),
    onToolCall: vi.fn(),
    onAgentEvent: vi.fn(),
    onDone: vi.fn(),
    onAgentError: vi.fn(),
    onConnectionError: vi.fn(),
    onDispose: vi.fn(),
  };
  const client = createLocalAgentSseClient({
    endpoint: " http://127.0.0.1:17371/ ",
    token: "token value",
    clientId: "client/id",
    callbacks,
  }, services);
  return { callbacks, client, fetchMock, services, source };
}

describe("Canvas local Agent SSE client", () => {
  it("preserves the EventSource URL and posts the current snapshot after hello", async () => {
    const { callbacks, fetchMock, services, source } = setup();

    expect(services.createEventSource).toHaveBeenCalledWith(
      "http://127.0.0.1:17371/events?token=token%20value&clientId=client%2Fid",
    );
    source.emit("hello");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(callbacks.onHello).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://127.0.0.1:17371/canvas/state?token=token%20value&clientId=client%2Fid",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      projectId: "project",
      protocolVersion: "1.0",
    });
  });

  it("routes valid tools and rejects unknown tools through the result endpoint", async () => {
    const { callbacks, fetchMock, source } = setup();

    source.emit("tool_call", {
      requestId: "valid",
      name: "canvas_get_state",
      input: {},
    });
    expect(callbacks.onToolCall).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "valid",
      name: "canvas_get_state",
    }));

    source.emit("tool_call", { requestId: "unknown", name: "other_tool" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      requestId: "unknown",
      error: "不支持的工具：other_tool",
      protocolVersion: "1.0",
    });
  });

  it("keeps native reconnect after a connected error and closes on an initial failure", () => {
    const connected = setup();
    connected.source.emit("hello");
    connected.source.onerror?.({} as Event);
    expect(connected.callbacks.onConnectionError).toHaveBeenCalledWith(true);
    expect(connected.source.close).not.toHaveBeenCalled();

    const initial = setup();
    initial.source.onerror?.({} as Event);
    expect(initial.callbacks.onConnectionError).toHaveBeenCalledWith(false);
    expect(initial.source.close).toHaveBeenCalledTimes(1);

    initial.client.close();
    expect(initial.source.close).toHaveBeenCalledTimes(2);
    expect(initial.callbacks.onDispose).toHaveBeenCalledTimes(1);
  });
});
