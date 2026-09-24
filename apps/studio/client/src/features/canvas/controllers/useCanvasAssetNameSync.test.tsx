// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { CanvasProvider } from "../ui/CanvasProvider";
import { createCanvasStore } from "../model/store";
import { renameCanvasNode } from "../domain/nodeTitles";
import type { CanvasNodeData } from "../domain/types";
import { syncCanvasNodeAssetName } from "../services/assetNames";
import { useCanvasAssetNameSync } from "./useCanvasAssetNameSync";

vi.mock("../services/assetNames", async importOriginal => ({
  ...await importOriginal<typeof import("../services/assetNames")>(), syncCanvasNodeAssetName: vi.fn(async () => undefined),
}));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it.each(["image", "video", "audio"] as const)("syncs the final collision title when a new %s resource is attached", async kind => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const first: CanvasNodeData = { id: "first", title: "女王的毒苹果", kind, x: 0, y: 0, width: 200, height: 200, content: "", metadata: { assetId: "original" } };
  const store = createCanvasStore({ session: { loading: false, canonicalProjectScope: "personal" }, graph: { nodes: [first] } });
  const root = createRoot(document.createElement("div"));
  function Harness() { useCanvasAssetNameSync("user", "project"); return null; }
  try {
    await act(async () => root.render(<QueryClientProvider client={new QueryClient()}><CanvasProvider store={store}><Harness /></CanvasProvider></QueryClientProvider>));
    await act(async () => store.getState().actions.setField("graph", "nodes", nodes => [...nodes, { ...first, id: "second", metadata: { assetId: "new-output" } }]));
    const added = store.getState().graph.nodes.find(n => n.id === "second")!;
    expect(added.title).toBe("女王的毒苹果（1）");
    expect(syncCanvasNodeAssetName).toHaveBeenCalledWith(added, { userId: "user", projectId: "project", scope: "personal" });
    vi.mocked(syncCanvasNodeAssetName).mockClear();
    await act(async () => store.getState().actions.setField("graph", "nodes", nodes => [...nodes, { ...first, id: "shared-copy" }]));
    expect(syncCanvasNodeAssetName).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});

it("reconciles historical unnumbered catalog names once after hydration and skips shared source assets", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = (id: string, assetId: string, title: string): CanvasNodeData => ({ id, title, kind: "image", x: 0, y: 0, width: 200, height: 200, content: "", metadata: { assetId } });
  const store = createCanvasStore({ session: { loading: true, canonicalProjectScope: "personal" }, graph: { nodes: [
    node("one", "unique", "苹果（1）"), node("two", "shared", "梨"), node("three", "shared", "梨（1）"),
  ] } });
  const root = createRoot(document.createElement("div"));
  const client = new QueryClient();
  function Harness({ name }: { name: string }) { useCanvasAssetNameSync("user", "project", [
    { id: "unique", name, scope: "personal" }, { id: "shared", name: "梨", scope: "personal" },
  ]); return null; }
  const render = (name: string) => root.render(<QueryClientProvider client={client}><CanvasProvider store={store}><Harness name={name} /></CanvasProvider></QueryClientProvider>);
  try {
    await act(async () => render("苹果"));
    expect(syncCanvasNodeAssetName).not.toHaveBeenCalled();
    await act(async () => store.getState().actions.setField("session", "loading", false));
    expect(vi.mocked(syncCanvasNodeAssetName).mock.calls.map(([node]) => node.title)).toEqual(["苹果（1）"]);
    await act(async () => render("迟到的旧名称"));
    expect(syncCanvasNodeAssetName).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); }
});

it("syncs all names changed by collision and undo, without writing during hydration, selection or dragging", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const store = createCanvasStore({ session: { loading: true, canonicalProjectScope: "personal" } });
  const root = createRoot(document.createElement("div"));
  function Harness() { useCanvasAssetNameSync("user", "project"); return null; }
  const node = (id: string, title: string): CanvasNodeData => ({ id, title, kind: "image", x: 0, y: 0, width: 200, height: 200, content: "",
    metadata: { assetId: id, titleEdited: true, titleBase: title, titleMode: "custom" } });
  try {
    await act(async () => root.render(<QueryClientProvider client={new QueryClient()}><CanvasProvider store={store}><Harness /></CanvasProvider></QueryClientProvider>));
    const actions = store.getState().actions;
    actions.commit({ graph: { nodes: [node("a", "苹果"), node("b", "梨")] } });
    await act(async () => actions.setField("session", "loading", false));
    actions.setField("graph", "selectedNodeId", "a");
    actions.setField("graph", "nodes", nodes => nodes.map(node => ({ ...node, x: 120 })));
    expect(syncCanvasNodeAssetName).not.toHaveBeenCalled();
    const before = store.getState().graph.nodes;
    actions.setField("graph", "nodes", nodes => renameCanvasNode(nodes, "b", "苹果"));
    expect(vi.mocked(syncCanvasNodeAssetName).mock.calls.map(([node]) => [node.id, node.title])).toEqual([["a", "苹果-1"], ["b", "苹果-2"]]);
    vi.mocked(syncCanvasNodeAssetName).mockClear();
    actions.commit({ graph: { nodes: before } });
    expect(vi.mocked(syncCanvasNodeAssetName).mock.calls.map(([node]) => [node.id, node.title])).toEqual([["a", "苹果"], ["b", "梨"]]);
    vi.mocked(syncCanvasNodeAssetName).mockClear();
    await act(async () => actions.setField("session", "loading", true));
    actions.commit({ graph: { nodes: [node("a", "另一个画布")] } });
    await act(async () => actions.setField("session", "loading", false));
    expect(syncCanvasNodeAssetName).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});
