import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import {
  createCanvasCommands,
  createLatestCanvasCommandProxy,
  type CanvasCommands,
  type LatestCanvasCommandProxy,
} from "@/features/canvas/model/commands";
import {
  createCanvasStore,
  type CanvasSliceName,
  type CanvasStateSetter,
  type CanvasStoreApi,
  type CanvasStoreInitialState,
  type CanvasStoreSlices,
  type CanvasStoreState,
} from "@/features/canvas/model/store";
import {
  createCanvasServices,
  type CanvasServices,
} from "@/features/canvas/services/contracts";

type CanvasRuntime = {
  store: CanvasStoreApi;
  services: CanvasServices;
  commands: CanvasCommands;
};

const CanvasRuntimeContext = createContext<CanvasRuntime | null>(null);

export type CanvasProviderProps = {
  children: ReactNode;
  initialState?: CanvasStoreInitialState;
  store?: CanvasStoreApi;
  services?: CanvasServices;
};

export function CanvasProvider({
  children,
  initialState,
  store,
  services,
}: CanvasProviderProps) {
  const runtimeRef = useRef<CanvasRuntime | null>(null);
  if (!runtimeRef.current) {
    const scopedStore = store || createCanvasStore(initialState);
    const scopedServices = services || createCanvasServices();
    runtimeRef.current = {
      store: scopedStore,
      services: scopedServices,
      commands: createCanvasCommands(scopedStore, scopedServices),
    };
  }

  return (
    <CanvasRuntimeContext.Provider value={runtimeRef.current}>
      {children}
    </CanvasRuntimeContext.Provider>
  );
}

function useCanvasRuntime() {
  const runtime = useContext(CanvasRuntimeContext);
  if (!runtime) throw new Error("Canvas hooks must be used within CanvasProvider");
  return runtime;
}

export function useCanvasStore<Value>(
  selector: (state: CanvasStoreState) => Value,
): Value {
  return useStore(useCanvasRuntime().store, selector);
}

export function useCanvasStoreApi() {
  return useCanvasRuntime().store;
}

export function useCanvasCommands() {
  return useCanvasRuntime().commands;
}

export function useLatestCanvasCommandProxy<CommandSet extends object>(
  commands: CommandSet,
): CommandSet {
  const proxyRef = useRef<LatestCanvasCommandProxy<CommandSet> | null>(null);
  if (!proxyRef.current) {
    proxyRef.current = createLatestCanvasCommandProxy(commands);
  } else {
    proxyRef.current.update(commands);
  }
  return proxyRef.current.commands;
}

export function useCanvasServices() {
  return useCanvasRuntime().services;
}

export function useCanvasField<
  Slice extends CanvasSliceName,
  Field extends keyof CanvasStoreSlices[Slice],
>(
  slice: Slice,
  field: Field,
): [
  CanvasStoreSlices[Slice][Field],
  CanvasStateSetter<CanvasStoreSlices[Slice][Field]>,
] {
  const value = useCanvasStore((state) => state[slice][field]);
  const setField = useCanvasStore((state) => state.actions.setField);
  const setValue: CanvasStateSetter<CanvasStoreSlices[Slice][Field]> = useCallback(
    (update) => setField(slice, field, update),
    [field, setField, slice],
  );
  return [value, setValue];
}
