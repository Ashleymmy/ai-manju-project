// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  clearStoredAuthSession: vi.fn(),
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@/entities/auth", () => ({
  clearStoredAuthSession: authMocks.clearStoredAuthSession,
  getCurrentUser: authMocks.getCurrentUser,
  logout: authMocks.logout,
}));

import { AuthProvider, useAuth } from "./AuthContext";

const firstUser = {
  id: "user-1",
  username: "first",
  role: "member",
  status: "active",
};

const secondUser = {
  id: "user-2",
  username: "second",
  role: "member",
  status: "active",
};

describe("AuthProvider query cache boundary", () => {
  let auth: ReturnType<typeof useAuth> | null;
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let root: Root;

  function AuthProbe() {
    auth = useAuth();
    return null;
  }

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    auth = null;
    authMocks.clearStoredAuthSession.mockReset();
    authMocks.getCurrentUser.mockReset().mockResolvedValue(firstUser);
    authMocks.logout.mockReset().mockResolvedValue(undefined);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["private", "workspace"], "stale-user-data");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AuthProbe />
          </AuthProvider>
        </QueryClientProvider>
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("clears cached server state whenever the authenticated identity changes", async () => {
    expect(queryClient.getQueryData(["private", "workspace"])).toBeUndefined();

    queryClient.setQueryData(["private", "workspace"], "same-user-data");
    await act(async () => auth?.refreshUser());
    expect(queryClient.getQueryData(["private", "workspace"])).toBe(
      "same-user-data"
    );

    authMocks.getCurrentUser.mockResolvedValueOnce(secondUser);
    await act(async () => auth?.refreshUser());
    expect(queryClient.getQueryData(["private", "workspace"])).toBeUndefined();
  });

  it("clears cached state on unauthorized events and logout", async () => {
    queryClient.setQueryData(["private", "workspace"], "unauthorized-data");
    await act(async () => {
      window.dispatchEvent(new Event("ai-manju:auth-unauthorized"));
    });
    expect(queryClient.getQueryData(["private", "workspace"])).toBeUndefined();
    expect(authMocks.clearStoredAuthSession).toHaveBeenCalled();

    authMocks.getCurrentUser.mockResolvedValueOnce(firstUser);
    await act(async () => auth?.refreshUser());
    queryClient.setQueryData(["private", "workspace"], "logout-data");
    await act(async () => auth?.logout());
    expect(queryClient.getQueryData(["private", "workspace"])).toBeUndefined();
    expect(authMocks.logout).toHaveBeenCalledTimes(1);
  });
});
