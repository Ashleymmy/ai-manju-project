import { RetryImage } from "@/shared/ui/RetryImage";
import { useRef, useState } from "react";
import { Loader2, Upload, UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { seedanceAssetThumbnailSource, uploadUserSeedanceAsset } from "@/entities/asset";
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

export function SeedanceAssetThumbnail({ source, assetType, name }: { source?: string; assetType: string; name?: string }) {
  const url = seedanceAssetThumbnailSource(source, assetType);
  const fallback = <UserRoundCog size={22} />;
  return url ? <RetryImage src={url} alt={name || "素材预览"} fallback={fallback} /> : fallback;
}
