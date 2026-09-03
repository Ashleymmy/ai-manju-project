// @vitest-environment jsdom

import {
  memo,
  StrictMode,
  useEffect,
} from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasCommands } from "@/features/canvas/model/commands";
import {
  createCanvasStore,
  selectCanvasNodes,
  type CanvasStoreApi,
} from "@/features/canvas/model/store";
import {
  createCanvasServices,
  type CanvasServiceExecutor,
} from "@/features/canvas/services/contracts";
import {
  CanvasProvider,
  useCanvasCommands,
  useLatestCanvasCommandProxy,
  useCanvasStore,
  useCanvasStoreApi,
} from "./CanvasProvider";

const node = (title: string) => ({
  id: "shared-node",
  kind: "text" as const,
  title,
  content: title,
  x: 0,
  y: 0,
  width: 240,
  height: 160,
});

describe("CanvasProvider", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps two mounted canvas instances and their services isolated", async () => {
    const storeA = createCanvasStore();
    const storeB = createCanvasStore();
    const serviceCalls = { a: 0, b: 0 };
    const serviceA: CanvasServiceExecutor = async (operation) => {
      serviceCalls.a += 1;
      return operation();
    };
    const serviceB: CanvasServiceExecutor = async (operation) => {
      serviceCalls.b += 1;
      return operation();
    };
    const commands = new Map<string, CanvasCommands>();
    const renderCounts = { a: 0, b: 0 };

    function Probe({ id }: { id: "a" | "b" }) {
      const instanceCommands = useCanvasCommands();
      const nodes = useCanvasStore(selectCanvasNodes);
      renderCounts[id] += 1;
      useEffect(() => {
        commands.set(id, instanceCommands);
      }, [id, instanceCommands]);
      return <span data-testid={id}>{nodes[0]?.title || "empty"}</span>;
    }

    function Host({ showA }: { showA: boolean }) {
      return (
        <>
          {showA ? (
            <CanvasProvider
              key="a"
              store={storeA}
              services={createCanvasServices({ generation: serviceA })}
            >
              <Probe id="a" />
            </CanvasProvider>
          ) : null}
          <CanvasProvider
            key="b"
            store={storeB}
            services={createCanvasServices({ generation: serviceB })}
          >
            <Probe id="b" />
          </CanvasProvider>
        </>
      );
    }

    await act(async () => root.render(<Host showA />));
    await act(async () => {
      commands.get("a")?.graph.setNodes([node("A")]);
      commands.get("b")?.graph.setNodes([node("B")]);
    });

    expect(container.querySelector('[data-testid="a"]')?.textContent).toBe("A");
    expect(container.querySelector('[data-testid="b"]')?.textContent).toBe("B");

    const beforeUnrelatedUpdate = renderCounts.b;
    await act(async () => commands.get("b")?.ui.setInspectorOpen(true));
    expect(renderCounts.b).toBe(beforeUnrelatedUpdate);

    await expect(commands.get("a")?.services.generation(async () => "A")).resolves.toBe("A");
    await expect(commands.get("b")?.services.generation(async () => "B")).resolves.toBe("B");
    expect(serviceCalls).toEqual({ a: 1, b: 1 });

    await act(async () => root.render(<Host showA={false} />));
    await act(async () => commands.get("b")?.graph.setNodes([node("B-after-A-unmount")]));
    expect(container.querySelector('[data-testid="b"]')?.textContent).toBe("B-after-A-unmount");
    await expect(commands.get("b")?.services.generation(async () => "B-still-live"))
      .resolves.toBe("B-still-live");
    expect(serviceCalls).toEqual({ a: 1, b: 2 });
  });

  it("retains one committed store and command identity through StrictMode effects", async () => {
    const stores = new Set<CanvasStoreApi>();
    const commands = new Set<CanvasCommands>();
    let latestCommands: CanvasCommands | null = null;

    function IdentityProbe() {
      const store = useCanvasStoreApi();
      const instanceCommands = useCanvasCommands();
      const nodes = useCanvasStore(selectCanvasNodes);
      latestCommands = instanceCommands;
      useEffect(() => {
        stores.add(store);
        commands.add(instanceCommands);
      }, [instanceCommands, store]);
      return <span data-testid="identity-probe">{nodes[0]?.title || "empty"}</span>;
    }

    await act(async () => root.render(
      <StrictMode>
        <CanvasProvider>
          <IdentityProbe />
        </CanvasProvider>
      </StrictMode>
    ));

    expect(stores.size).toBe(1);
    expect(commands.size).toBe(1);

    await act(async () => latestCommands?.graph.setNodes([node("committed")]));

    expect(container.querySelector('[data-testid="identity-probe"]')?.textContent).toBe("committed");
    expect(stores.size).toBe(1);
    expect(commands.size).toBe(1);
  });

  it("keeps a memoized command identity while dispatching to the latest handler", async () => {
    const calls: string[] = [];
    let childRenderCount = 0;

    const CommandTarget = memo(function CommandTarget({
      commands,
    }: {
      commands: { run: () => void };
    }) {
      childRenderCount += 1;
      return <button type="button" onClick={commands.run}>Run</button>;
    });

    function Host({ value }: { value: string }) {
      const commands = useLatestCanvasCommandProxy({
        run: () => calls.push(value),
      });
      return <CommandTarget commands={commands} />;
    }

    await act(async () => root.render(<Host value="first" />));
    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    await act(async () => root.render(<Host value="latest" />));
    expect(container.querySelector("button")).toBe(button);
    expect(childRenderCount).toBe(1);

    await act(async () => button?.click());
    expect(calls).toEqual(["latest"]);
  });
});
