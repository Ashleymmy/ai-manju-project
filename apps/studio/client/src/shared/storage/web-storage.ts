export function createWebStorageAdapter(storage: Storage): Storage {
  return {
    get length() {
      return storage.length;
    },
    clear() {
      storage.clear();
    },
    getItem(key) {
      return storage.getItem(key);
    },
    key(index) {
      return storage.key(index);
    },
    removeItem(key) {
      storage.removeItem(key);
    },
    setItem(key, value) {
      storage.setItem(key, value);
    },
  };
}

export function getLocalStorageAdapter(storage: Storage = window.localStorage) {
  return createWebStorageAdapter(storage);
}

export function getSessionStorageAdapter(
  storage: Storage = window.sessionStorage
) {
  return createWebStorageAdapter(storage);
}
