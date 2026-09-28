import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { invalidateAssetScope } from "@/entities/asset";
import { importTaskManager, useImportTask } from "../model/importTaskManager";
import { AssetImportTaskPanel } from "./AssetImportTaskPanel";
import "./importTask.css";

export function AssetImportTaskHost() {
  const { user, loading } = useAuth();
  const { task, preparing, open } = useImportTask();
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
  return <Dialog open={open} onOpenChange={value => value ? importTaskManager.open() : importTaskManager.close()}>
    <DialogContent className="asset-import-task-dialog sm:max-w-[760px]">
      <DialogHeader><DialogTitle>导入任务</DialogTitle><DialogDescription>
        {preparing ? "正在保存资产包，保存完成前请勿刷新或关闭页面。" : "切换页面会继续导入，刷新后会自动接续。关闭浏览器期间暂停，再次打开并登录后接续。"}
      </DialogDescription></DialogHeader>
      <AssetImportTaskPanel />
    </DialogContent>
  </Dialog>;
}
