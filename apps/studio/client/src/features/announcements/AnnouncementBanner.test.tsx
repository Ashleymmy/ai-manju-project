// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const announcementMocks = vi.hoisted(() => ({
  fetchCurrentAnnouncement: vi.fn(),
  markAnnouncementRead: vi.fn(),
}));

vi.mock("@/entities/announcement", () => ({
  announcementQueryKeys: {
    current: () => ["announcements", "current"] as const,
  },
  announcementStreamUrl: () => "http://127.0.0.1/api/announcements/stream",
  fetchCurrentAnnouncement: announcementMocks.fetchCurrentAnnouncement,
  markAnnouncementRead: announcementMocks.markAnnouncementRead,
}));

import AnnouncementBanner from "./AnnouncementBanner";

type EventListenerCallback = (event: Event) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, EventListenerCallback[]>();
  readonly close = vi.fn();
  onerror: EventListenerCallback | null = null;
  onopen: EventListenerCallback | null = null;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback: EventListenerCallback =
      typeof listener === "function"
        ? listener
        : event => listener.handleEvent(event);
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(callback);
    this.listeners.set(type, listeners);
  }

  emit(type: string) {
    const event = new Event(type);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("AnnouncementBanner stream lifecycle", () => {
  let container: HTMLDivElement;
  let mounted: boolean;
  let queryClient: QueryClient;
  let root: Root;

  beforeEach(async () => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    announcementMocks.fetchCurrentAnnouncement.mockReset().mockResolvedValue(null);
    announcementMocks.markAnnouncementRead.mockReset().mockResolvedValue({
      read_at: "2026-09-02T00:00:00Z",
    });
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mounted = true;
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AnnouncementBanner />
        </QueryClientProvider>
      );
    });
  });

  afterEach(async () => {
    if (mounted) await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("refreshes on stream events and reconnects after 3.5 seconds", async () => {
    expect(FakeEventSource.instances).toHaveLength(1);
    const first = FakeEventSource.instances[0];

    const beforeOpen = announcementMocks.fetchCurrentAnnouncement.mock.calls.length;
    await act(async () => first.onopen?.(new Event("open")));
    expect(announcementMocks.fetchCurrentAnnouncement.mock.calls.length).toBeGreaterThan(
      beforeOpen
    );

    const beforePublish = announcementMocks.fetchCurrentAnnouncement.mock.calls.length;
    await act(async () => first.emit("announcement.published"));
    expect(announcementMocks.fetchCurrentAnnouncement.mock.calls.length).toBeGreaterThan(
      beforePublish
    );

    await act(async () => first.onerror?.(new Event("error")));
    expect(first.close).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(3_499));
    expect(FakeEventSource.instances).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("cancels a pending reconnect when the banner unmounts", async () => {
    const first = FakeEventSource.instances[0];
    await act(async () => first.onerror?.(new Event("error")));

    await act(async () => root.unmount());
    mounted = false;
    await act(async () => vi.advanceTimersByTimeAsync(3_500));

    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
