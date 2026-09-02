import { describe, expect, it, vi } from "vitest";

import {
  DIRECTOR_PROTOCOL_VERSION,
  DIRECTOR_READY_TYPE,
  DIRECTOR_REQUEST_TYPE,
  DIRECTOR_RESPONSE_TYPE,
  DIRECTOR_SESSION_TYPE,
} from "../model/protocol";
import {
  DirectorBridgeClient,
  type DirectorBridgeEnvironment,
  type DirectorMessageEvent,
} from "./DirectorBridgeClient";

function createHarness() {
  let listener: ((event: DirectorMessageEvent) => void) | null = null;
  let requestSequence = 0;
  let timerSequence = 0;
  let removeCount = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const environment: DirectorBridgeEnvironment = {
    origin: "http://localhost:3100",
    addMessageListener(nextListener) {
      listener = nextListener;
      return () => {
        removeCount += 1;
        listener = null;
      };
    },
    setTimer(callback, delay) {
      const id = ++timerSequence;
      timers.set(id, {
        callback: () => {
          timers.delete(id);
          callback();
        },
        delay,
      });
      return id;
    },
    clearTimer(timer) {
      timers.delete(timer);
    },
  };
  const postMessage = vi.fn();
  const target = { postMessage };
  const onReady = vi.fn();
  const onCapabilities = vi.fn();
  const client = new DirectorBridgeClient({
    environment,
    getTarget: () => target,
    instanceId: "director-instance",
    callbacks: { onReady, onCapabilities },
    createRequestId: () => `request-${++requestSequence}`,
  });
  client.start();

  return {
    client,
    target,
    postMessage,
    onReady,
    onCapabilities,
    timers,
    emit(event: Partial<DirectorMessageEvent> & { data: unknown }) {
      listener?.({
        origin: event.origin || environment.origin,
        source: event.source === undefined ? target : event.source,
        data: event.data,
      });
    },
    removeCount: () => removeCount,
  };
}

function response(
  requestId: string,
  action: string,
  input: { ok?: boolean; data?: unknown; message?: string } = {}
) {
  return {
    type: DIRECTOR_RESPONSE_TYPE,
    payload: {
      protocolVersion: DIRECTOR_PROTOCOL_VERSION,
      requestId,
      action,
      ok: input.ok ?? true,
      data: input.data,
      ...(input.message
        ? { error: { code: "DIRECTOR_ERROR", message: input.message } }
        : {}),
    },
  };
}

describe("DirectorBridgeClient", () => {
  it("accepts ready only from the current same-origin iframe", async () => {
    const harness = createHarness();

    harness.emit({
      origin: "https://evil.test",
      data: { type: DIRECTOR_READY_TYPE },
    });
    harness.emit({
      source: { postMessage: vi.fn() },
      data: { type: DIRECTOR_READY_TYPE },
    });
    expect(harness.postMessage).not.toHaveBeenCalled();

    harness.emit({ data: { type: DIRECTOR_READY_TYPE } });
    expect(harness.onReady).toHaveBeenCalledOnce();
    expect(harness.postMessage).toHaveBeenNthCalledWith(
      1,
      {
        type: DIRECTOR_SESSION_TYPE,
        payload: { instanceId: "director-instance", theme: "dark" },
      },
      "http://localhost:3100"
    );
    expect(harness.postMessage).toHaveBeenNthCalledWith(
      2,
      {
        type: DIRECTOR_REQUEST_TYPE,
        payload: {
          requestId: "request-1",
          action: "capabilities.get",
        },
      },
      "http://localhost:3100"
    );

    const capabilities = { protocolVersion: 1, exportFrame: true };
    harness.emit({
      data: response("request-1", "capabilities.get", {
        data: capabilities,
      }),
    });
    await Promise.resolve();
    expect(harness.onCapabilities).toHaveBeenCalledWith(capabilities);
    expect(harness.timers.size).toBe(0);
    harness.client.dispose();
  });

  it("resolves matching requests and rejects mismatched or failed responses", async () => {
    const harness = createHarness();
    const projectRequest = harness.client.request("project.get", {
      includeAssets: true,
    });
    expect(harness.postMessage).toHaveBeenCalledWith(
      {
        type: DIRECTOR_REQUEST_TYPE,
        payload: {
          requestId: "request-1",
          action: "project.get",
          options: { includeAssets: true },
        },
      },
      "http://localhost:3100"
    );
    harness.emit({
      data: response("request-1", "timeline.get", { data: {} }),
    });
    await expect(projectRequest).rejects.toThrow(
      "导演台响应操作不匹配：project.get / timeline.get"
    );

    const timelineRequest = harness.client.request("timeline.get");
    harness.emit({
      data: response("request-2", "timeline.get", {
        ok: false,
        message: "timeline unavailable",
      }),
    });
    await expect(timelineRequest).rejects.toThrow("timeline unavailable");
    expect(harness.timers.size).toBe(0);
    harness.client.dispose();
  });

  it("cleans pending requests on timeout and dispose", async () => {
    const harness = createHarness();
    const timedOut = harness.client.request("export.frame");
    const timer = [...harness.timers.values()][0];
    expect(timer.delay).toBe(20_000);
    timer.callback();
    await expect(timedOut).rejects.toThrow("导演台请求超时：export.frame");
    expect(harness.timers.size).toBe(0);

    const pending = harness.client.request("export.video");
    expect([...harness.timers.values()][0].delay).toBe(60_000);
    harness.client.dispose();
    await expect(pending).rejects.toThrow("导演台 iframe 已关闭");
    expect(harness.timers.size).toBe(0);
    expect(harness.removeCount()).toBe(1);
    await expect(harness.client.request("project.get")).rejects.toThrow(
      "导演台 iframe 已关闭"
    );
  });

  it("rejects immediately when the iframe target is unavailable", async () => {
    const environment: DirectorBridgeEnvironment = {
      origin: "http://localhost:3100",
      addMessageListener: () => () => undefined,
      setTimer: () => 1,
      clearTimer: () => undefined,
    };
    const client = new DirectorBridgeClient({
      environment,
      getTarget: () => null,
      instanceId: "director-instance",
      callbacks: { onReady: vi.fn(), onCapabilities: vi.fn() },
    });

    await expect(client.request("project.get")).rejects.toThrow(
      "导演台 iframe 尚未准备好"
    );
  });
});
