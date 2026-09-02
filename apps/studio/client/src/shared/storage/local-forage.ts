import localforage from "localforage";

export interface LocalForageStorageAdapter {
  clear(): Promise<void>;
  getItem<T>(key: string): Promise<T | null>;
  keys(): Promise<string[]>;
  removeItem(key: string): Promise<void>;
  setItem<T>(key: string, value: T): Promise<T>;
}

export function createLocalForageStorageAdapter(
  storage: LocalForageStorageAdapter = localforage
): LocalForageStorageAdapter {
  return {
    clear: () => storage.clear(),
    getItem: <T>(key: string) => storage.getItem<T>(key),
    keys: () => storage.keys(),
    removeItem: (key: string) => storage.removeItem(key),
    setItem: <T>(key: string, value: T) => storage.setItem(key, value),
  };
}
