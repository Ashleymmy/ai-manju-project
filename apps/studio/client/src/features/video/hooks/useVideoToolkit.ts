import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { uploadAsset } from "@/entities/asset";
import { createSDVideoClient } from "@/entities/sd-video";
import { publicApiError } from "@/shared/api/errors";

export function useVideoToolkit() {
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function erase(file: File) {
    if (active.current) return;
    if (!file.type.startsWith("video/")) { toast.error("请选择视频文件"); return; }
    const controller = new AbortController();
    active.current = controller;
    const api = createSDVideoClient("personal", controller.signal);
    setBusy(true);
    try {
      const asset = await uploadAsset(file, {}, "personal", controller.signal);
      await api.eraseVideo(asset.id);
      toast.success("擦除任务已提交，可在任务队列查看，完成结果将进入资产库");
    } catch (error) {
      if (!controller.signal.aborted) toast.error(publicApiError(error, "提交擦除任务失败"));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      active.current = null;
    }
  }
  return { busy, erase };
}
