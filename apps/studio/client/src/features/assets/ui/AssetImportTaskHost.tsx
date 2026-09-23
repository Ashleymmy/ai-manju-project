import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderInput, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { invalidateAssetScope } from "@/entities/asset";
import { importTaskManager, useImportTask } from "../model/importTaskManager";
import { AssetTransferStatus } from "./AssetTransferStatus";
import "./importTask.css";

export function AssetImportTaskHost() {
  const { user, loading } = useAuth();
  const { task, preparing, open, error } = useImportTask();
  const queryClient = useQueryClient();
  useEffect(() => { if (!loading) importTaskManager.setOwner(user?.id || null); }, [user?.id, loading]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (importTaskManager.getSnapshot().preparing) { event.preventDefault(); event.returnValue = ""; }
    };
    const unauthorized = () => importTaskManager.setOwner(null);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", importTaskManager.pagehide);
    window.addEventListener("ai-manju:auth-unauthorized", unauthorized);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", importTaskManager.pagehide);
      window.removeEventListener("ai-manju:auth-unauthorized", unauthorized);
    };
  }, []);
  useEffect(() => {
    if (!task || task.owner !== user?.id || task.status === "running") return;
    void invalidateAssetScope(queryClient, task.scope);
    void queryClient.invalidateQueries({ queryKey: ["assets", "feature-overview", task.scope] });
  }, [queryClient, user?.id, task?.id, task?.scope, task?.status]);
  if (!user) return null;
  const running = preparing || task?.status === "running";
  const status = preparing ? "准备中" : task?.status === "running" ? "导入中" : task?.status === "paused" ? "已暂停" : task?.status === "failed" ? "待处理" : task?.status === "completed" ? "已完成" : "";
  return <>
    <button type="button" className="asset-import-task-entry" onClick={importTaskManager.open} aria-label="查看导入任务">
      {running ? <Loader2 size={16} className="asset-transfer-spinner" /> : <FolderInput size={16} />}
      <span>导入任务{status && ` · ${status}`}</span>
      {task && <strong>{task.progress.completed}/{task.progress.total}</strong>}
    </button>
    <Dialog open={open} onOpenChange={value => value ? importTaskManager.open() : importTaskManager.close()}>
      <DialogContent className="asset-import-task-dialog sm:max-w-[760px]">
        <DialogHeader><DialogTitle>导入任务</DialogTitle><DialogDescription>
          {preparing ? "正在保存资产包，保存完成前请勿刷新或关闭页面。" : "切换页面会继续导入，刷新后会自动接续。关闭浏览器期间暂停，再次打开并登录后接续。"}
        </DialogDescription></DialogHeader>
        {error && <p role="alert">{error}</p>}
        {preparing && <p role="status">正在保存资产包以供自动恢复…</p>}
        {task && <>
          <p className="asset-import-task-source">{task.name} · {task.scope === "personal" ? "个人素材" : "团队素材"}</p>
          <AssetTransferStatus batches={[]} progress={task.progress} warnings={task.warnings}
            importing={task.status === "running"} canPause={task.status === "running"}
            canRetry={task.status === "paused" || task.status === "failed"}
            onPause={importTaskManager.pause} onRetry={importTaskManager.resume} onDismiss={importTaskManager.close}
            onDownload={() => {}} onCancel={() => {}} />
          {task.status !== "completed" && <button type="button" className="asset-import-task-end" onClick={() => {
            if (window.confirm("结束此任务并清除本地资产包？已导入的素材会保留；未完成项需要重新选择资产包。")) importTaskManager.discard();
          }}>结束任务</button>}
        </>}
        {!task && !preparing && !error && <p>暂无导入任务。可以从资产库选择「导入资产包」。</p>}
      </DialogContent>
    </Dialog>
  </>;
}
