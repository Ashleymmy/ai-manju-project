import { useSyncExternalStore } from "react";
import { getAuthToken } from "@/shared/api/http/request";
import type { WorkspaceScope } from "@/shared/config";
import { readAssetPackageContents } from "./assetPackage";
import { AssetPackageImportSession } from "./importAssetPackage";
import { IMPORT_POLL_MS, importTaskStorage, type ImportTask } from "./importTaskStorage";

type TaskView = { task?: ImportTask; preparing: boolean; open: boolean; error?: string };
const message = (error: unknown) => error instanceof Error ? error.message || error.name : "导入任务发生错误";

/** Owns the task outside route lifecycles. Only serializable state is saved;
 * archive indexes/files are reconstructed lazily after a refresh. */
export class ImportTaskManager {
  private view: TaskView = { preparing: false, open: false };
  private listeners = new Set<() => void>();
  private owner: string | null = null;
  private authorizedToken: string | null = null;
  private readonly holder = crypto.randomUUID();
  private controller?: AbortController;
  private running = false;
  private polling = false;
  private timer?: ReturnType<typeof setInterval>;
  private blockedTask?: string;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.view;
  private publish(patch: Partial<TaskView>) {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach(listener => listener());
  }
  open = () => this.publish({ open: true });
  close = () => this.publish({ open: false });

  setOwner(owner: string | null) {
    const token = getAuthToken();
    if (owner === this.owner && token === this.authorizedToken) return;
    this.controller?.abort();
    this.owner = owner;
    this.authorizedToken = token;
    this.blockedTask = undefined;
    this.publish({ task: undefined, preparing: false, error: undefined, open: false });
    if (this.timer) clearInterval(this.timer);
    this.timer = owner ? setInterval(() => { void this.tick(); }, IMPORT_POLL_MS) : undefined;
    if (owner) void this.tick();
  }

  private async tick() {
    const owner = this.owner;
    if (!owner || getAuthToken() !== this.authorizedToken || this.polling || this.running || this.view.preparing) return;
    this.polling = true;
    try {
      const task = await importTaskStorage.get(owner);
      if (owner !== this.owner) return;
      if (this.blockedTask && task?.id === this.blockedTask && task.status === "running" && !task.holder) return;
      this.blockedTask = undefined;
      this.publish({ task });
      if (task?.status === "running") {
        const claimed = await importTaskStorage.claim(owner, this.holder);
        if (claimed && owner === this.owner && getAuthToken() === this.authorizedToken) void this.run(claimed);
      }
    } catch (error) {
      if (owner === this.owner) this.publish({ error: `无法读取导入任务：${message(error)}` });
    } finally { this.polling = false; }
  }

  start = async (file: File, scope: WorkspaceScope, fallbackFolderId?: string) => {
    const owner = this.owner;
    if (!owner || getAuthToken() !== this.authorizedToken) throw new Error("请登录后导入资产包");
    if (this.view.preparing || this.running || this.view.task && this.view.task.status !== "completed") {
      this.open(); throw new Error("请先完成或结束已有导入任务");
    }
    this.publish({ preparing: true, error: undefined, open: false });
    try {
      // A single transaction commits the source and record together. No server
      // mutations happen before this durable save has actually completed.
      await importTaskStorage.create({ id: crypto.randomUUID(), owner, name: file.name, size: file.size,
        scope, fallbackFolderId, status: "running", warnings: [],
        progress: { phase: "检查资产包…", total: 0, completed: 0, failures: [] } }, file);
      this.blockedTask = undefined;
    } catch (error) {
      if (owner === this.owner) this.publish({ error: `未开始导入：无法保存资产包以供刷新后恢复。请检查浏览器可用存储空间后重试。${message(error)}`, open: true });
      throw error;
    } finally {
      if (owner === this.owner) { this.publish({ preparing: false }); void this.tick(); }
    }
  };

  private async run(initial: ImportTask) {
    if (this.running) return;
    this.running = true;
    const controller = new AbortController();
    this.controller = controller;
    // Bind every continuation to the identity already verified by AuthProvider,
    // including a token change while awaiting the IndexedDB lease transaction.
    const token = this.authorizedToken;
    let task = initial;
    let heartbeatBusy = false;
    const checkAccount = () => {
      if (this.owner !== task.owner || getAuthToken() !== token || this.authorizedToken !== token) controller.abort();
      if (controller.signal.aborted) throw new DOMException("导入已暂停，可继续导入", "AbortError");
    };
    const guard = async () => {
      checkAccount();
      const claimed = await importTaskStorage.claim(task.owner, this.holder);
      if (!claimed || claimed.id !== task.id) controller.abort();
      checkAccount();
    };
    const show = () => { if (task.owner === this.owner) this.publish({ task }); };
    const save = async () => {
      checkAccount();
      await importTaskStorage.save(task, this.holder);
      show();
    };
    const heartbeat = setInterval(() => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      void guard().catch(() => controller.abort()).finally(() => { heartbeatBusy = false; });
    }, IMPORT_POLL_MS);
    try {
      show();
      const source = await importTaskStorage.source(task.owner);
      if (!source) throw new Error("本地资产包已不可用，请结束此任务后重新选择资产包");
      const contents = await readAssetPackageContents(source, controller.signal);
      task = { ...task, warnings: contents.warnings };
      const session = new AssetPackageImportSession(contents, task.scope, task.fallbackFolderId, undefined, {
        snapshot: task.snapshot,
        beforeRequest: guard,
        checkpoint: async snapshot => {
          task = { ...task, snapshot, progress: { ...task.progress, completed: snapshot.completed.length, total: session.total, failures: snapshot.failures.map(([, failure]) => failure) } };
          await save();
        },
      });
      await session.run(progress => { task = { ...task, progress }; show(); }, controller.signal);
      task = { ...task, status: task.progress.phase === "导入完成" ? "completed" : "failed" };
      await save();
    } catch (error) {
      if (!controller.signal.aborted) {
        const current = await importTaskStorage.get(task.owner).catch(() => undefined);
        if (current && current.id === task.id && (current.status === "paused" || current.holder !== this.holder)) {
          task = current;
          show();
          return;
        }
        task = { ...task, status: "failed", progress: { ...task.progress, phase: message(error) } };
        try { await save(); } catch {
          // Preserve the visible failure if its status could not be saved.
          // A later explicit resume, or another tab taking over, unblocks it.
          this.blockedTask = task.id;
        }
        show();
      }
    } finally {
      clearInterval(heartbeat);
      await importTaskStorage.command(task.owner, task.id, "release", this.holder).catch(() => {});
      this.controller = undefined;
      this.running = false;
      void this.tick();
    }
  }

  private async command(command: "pause" | "resume" | "discard") {
    const task = this.view.task;
    if (!task || task.owner !== this.owner) return;
    try {
      await importTaskStorage.command(task.owner, task.id, command);
      if (task.owner !== this.owner) return;
      if (command !== "resume") this.controller?.abort();
      this.blockedTask = undefined;
      if (command === "discard") this.publish({ task: undefined, error: undefined, open: false });
      else {
        const current = await importTaskStorage.get(task.owner);
        if (task.owner !== this.owner) return;
        this.publish({ task: current, error: undefined });
      }
      void this.tick();
    } catch (error) { this.publish({ error: `无法保存任务状态：${message(error)}` }); }
  }
  pause = () => { void this.command("pause"); };
  resume = () => { void this.command("resume"); };
  discard = () => { void this.command("discard"); };
  // Best effort fast handoff on refresh; lease expiry covers abrupt tab crashes.
  pagehide = () => {
    this.controller?.abort();
    const task = this.view.task;
    if (task) void importTaskStorage.command(task.owner, task.id, "release", this.holder).catch(() => {});
  };
}

export const importTaskManager = new ImportTaskManager();
export function useImportTask() {
  return useSyncExternalStore(importTaskManager.subscribe, importTaskManager.getSnapshot);
}
