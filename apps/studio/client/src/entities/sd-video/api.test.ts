// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthToken, setAuthToken } from "@/shared/api/http";
import { createSDVideoClient } from "./api";

const reply = (data: unknown) => new Response(JSON.stringify({ success: true, data }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearAuthToken();
});

describe("video client session authentication", () => {
  it("loads paginated conversations and messages using the existing cookie session", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ items: [{ id: "first" }], total: 2 }))
      .mockResolvedValueOnce(reply({ items: [{ id: "second" }], total: 2 }))
      .mockResolvedValueOnce(reply({ items: [{ id: "message" }], total: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createSDVideoClient("personal", new AbortController().signal);

    await expect(client.conversations()).resolves.toEqual([{ id: "first" }, { id: "second" }]);
    await expect(client.messages("first")).resolves.toEqual([{ id: "message" }]);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get("page"))).toEqual(["1", "2", "1"]);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(new URL(url).searchParams.get("scope")).toBe("personal");
      expect(init.credentials).toBe("include");
      expect(init.headers.Authorization).toBeUndefined();
    }
  });

  it("allows cookie-authenticated conversation writes and toolkit requests to reach server authentication", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reply({ id: "record", version: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createSDVideoClient("personal", new AbortController().signal);

    await client.createConversation("conversation", "视频创作");
    await client.createMessage({ id: "message", conversation_id: "conversation", text: "草稿" });
    await client.eraseVideo("asset-video");

    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/api/sd-video/conversations", "/api/sd-video/messages", "/api/sd-video/toolkit/erase",
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => init.credentials === "include" && init.method === "POST")).toBe(true);
  });

  it("keeps bearer authentication when a token is present", async () => {
    setAuthToken("original-token", false);
    const fetchMock = vi.fn().mockResolvedValue(reply({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await createSDVideoClient("personal", new AbortController().signal).conversations();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer original-token");
  });

  it.each([
    ["original-token", "different-token"],
    ["original-token", null],
    [null, "new-token"],
  ])("blocks an old client after credentials change from %s to %s", async (initial, next) => {
    if (initial) setAuthToken(initial, false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createSDVideoClient("personal", new AbortController().signal);
    if (next) setAuthToken(next, false);
    else clearAuthToken();

    await expect(client.createConversation("old-draft", "旧草稿")).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, "token"])("blocks disposed clients with cookie or token authentication (%s)", async token => {
    if (token) setAuthToken(token, false);
    const controller = new AbortController();
    const client = createSDVideoClient("personal", controller.signal);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    controller.abort();

    await expect(client.createConversation("old-draft", "旧草稿")).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops pagination if the account token changes between pages", async () => {
    setAuthToken("original-token", false);
    const fetchMock = vi.fn().mockImplementation(async () => {
      setAuthToken("different-token", false);
      return reply({ items: [{ id: "first" }], total: 2 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createSDVideoClient("personal", new AbortController().signal).conversations())
      .rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([401, 503])("preserves the server error when the cookie request fails with %s", async status => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: false, error: "original server error", request_id: "server-request" }), { status },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createSDVideoClient("personal", new AbortController().signal).conversations())
      .rejects.toMatchObject({ status, message: "original server error", requestId: "server-request" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
