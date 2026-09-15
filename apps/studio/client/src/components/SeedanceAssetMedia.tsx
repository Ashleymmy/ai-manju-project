import { useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { getSeedanceAssetPreviewUrl, uploadUserSeedanceAsset } from "@/entities/asset";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";

export function SeedanceAssetUpload({ scope, disabled, onRegistered }: {
  scope: WorkspaceScope;
  disabled?: boolean;
  onRegistered: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file?: File) => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      await uploadUserSeedanceAsset(file, scope);
      toast.success("已提交拟真人素材注册，审核通过后即可选用");
      onRegistered();
    } catch (error) {
      toast.error(publicApiError(error, "素材注册未完成，请刷新素材库核实状态后再操作"));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  return <>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,video/mp4" hidden disabled={disabled || uploading} onChange={(event) => void upload(event.target.files?.[0])} />
    <button type="button" className="outline-button small" disabled={disabled || uploading} onClick={() => input.current?.click()}>
      {uploading ? <Loader2 className="spin" size={13} /> : <Upload size={13} />}
      {uploading ? "正在上传注册…" : "上传并注册拟真人"}
    </button>
  </>;
}

export function useSeedanceAssetPreview(source?: string) {
  const [preview, setPreview] = useState<{ source?: string; url: string }>({ url: "" });
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    getSeedanceAssetPreviewUrl(source, controller.signal).then((url) => {
      if (controller.signal.aborted) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setPreview({ source, url });
    }).catch(() => {
      if (!controller.signal.aborted) setPreview({ source, url: "" });
    });
    return () => {
      controller.abort();
      if (objectUrl.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);
  return preview.source === source ? preview.url : "";
}
