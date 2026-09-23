import type { WorkspaceScope } from "@/shared/config";
import type { PackageImportProgress, PackageImportSnapshot } from "./importAssetPackage";

// Keep the large source Blob separate from small, frequently saved checkpoints.
export const IMPORT_TASK_DB = "ai-manju-asset-imports";
export const IMPORT_LEASE_MS = 15_000;
export const IMPORT_POLL_MS = 3_000;
const DB_VERSION = 1;
export type ImportTask = {
  id: string;
  owner: string;
  name: string;
  size: number;
  scope: WorkspaceScope;
  fallbackFolderId?: string;
  status: "running" | "paused" | "failed" | "completed";
  progress: PackageImportProgress;
  warnings: string[];
  snapshot?: PackageImportSnapshot;
  holder?: string;
  leaseUntil?: number;
};

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMPORT_TASK_DB, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("tasks", { keyPath: "owner" });
      request.result.createObjectStore("sources");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function transaction<T>(stores: string[], mode: IDBTransactionMode,
  action: (tx: IDBTransaction, result: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let value: T;
    let failure: Error | undefined;
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onabort = tx.onerror = () => { db.close(); reject(failure || tx.error || new Error("无法保存导入进度")); };
    try { action(tx, result => { value = result; }, error => { failure = error; tx.abort(); }); }
    catch (error) { failure = error as Error; tx.abort(); }
  });
}

export const importTaskStorage = {
  get(owner: string) {
    return transaction<ImportTask | undefined>(["tasks"], "readonly", (tx, done) => {
      const req = tx.objectStore("tasks").get(owner);
      req.onsuccess = () => done(req.result);
    });
  },
  source(owner: string) {
    return transaction<Blob | undefined>(["sources"], "readonly", (tx, done) => {
      const req = tx.objectStore("sources").get(owner);
      req.onsuccess = () => done(req.result);
    });
  },
  create(task: ImportTask, source: Blob) {
    return transaction<void>(["tasks", "sources"], "readwrite", (tx, done, fail) => {
      const tasks = tx.objectStore("tasks");
      const req = tasks.get(task.owner);
      req.onsuccess = () => {
        if (req.result && req.result.status !== "completed") return fail(new Error("请先完成或结束已有导入任务"));
        try {
          tasks.put(task);
          tx.objectStore("sources").put(source, task.owner);
          done();
        } catch (error) { fail(error as Error); }
      };
    });
  },
  // An IndexedDB transaction is also a cross-tab compare-and-swap on HTTP sites,
  // where Web Locks is unavailable. A crashed tab loses its short-lived lease.
  claim(owner: string, holder: string) {
    return transaction<ImportTask | undefined>(["tasks"], "readwrite", (tx, done) => {
      const tasks = tx.objectStore("tasks");
      const req = tasks.get(owner);
      req.onsuccess = () => {
        const task = req.result as ImportTask | undefined;
        if (!task || task.status !== "running" || (task.holder && task.holder !== holder && (task.leaseUntil || 0) > Date.now())) return done(undefined);
        task.holder = holder;
        task.leaseUntil = Date.now() + IMPORT_LEASE_MS;
        tasks.put(task); done(task);
      };
    });
  },
  save(task: ImportTask, holder: string) {
    return transaction<void>(["tasks", "sources"], "readwrite", (tx, done, fail) => {
      const tasks = tx.objectStore("tasks");
      const req = tasks.get(task.owner);
      req.onsuccess = () => {
        const current = req.result as ImportTask | undefined;
        if (!current || current.id !== task.id || current.holder !== holder || current.status !== "running" || (current.leaseUntil || 0) < Date.now()) {
          return fail(new Error("任务已暂停或已由其他页面接续"));
        }
        tasks.put({ ...task, holder, leaseUntil: Date.now() + IMPORT_LEASE_MS });
        if (task.status === "completed") tx.objectStore("sources").delete(task.owner);
        done();
      };
    });
  },
  command(owner: string, id: string, command: "pause" | "resume" | "discard" | "release", holder?: string) {
    return transaction<void>(["tasks", "sources"], "readwrite", (tx, done) => {
      const tasks = tx.objectStore("tasks");
      const req = tasks.get(owner);
      req.onsuccess = () => {
        const task = req.result as ImportTask | undefined;
        if (!task || task.id !== id) return done();
        if (command === "discard") {
          tasks.delete(owner); tx.objectStore("sources").delete(owner);
        } else if (command === "release") {
          if (task.holder === holder) tasks.put({ ...task, holder: undefined, leaseUntil: undefined });
        } else if (task.status !== "completed") {
          // Pause invalidates the lease immediately, including in another tab.
          // Never revoke another tab's lease for an already running task.
          if (command === "pause" || task.status !== "running") tasks.put({ ...task,
            status: command === "pause" ? "paused" : "running", holder: undefined, leaseUntil: undefined,
            progress: { ...task.progress, phase: command === "pause" ? "导入已暂停，可继续导入" : "正在恢复导入…" } });
        }
        done();
      };
    });
  },
};
