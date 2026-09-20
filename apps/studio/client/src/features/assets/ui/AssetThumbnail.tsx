import { getAssetMediaUrl } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";
import { RetryImage } from "@/shared/ui/RetryImage";

// Gallery cards only request small previews, independently and near the viewport.
const ASSET_THUMBNAIL_WIDTH = 320 as const;
export function AssetThumbnail({ id, scope, name, className, onDoubleClick }: {
  id: string;
  scope: WorkspaceScope;
  name: string;
  className?: string;
  onDoubleClick?: () => void;
}) {
  return <RetryImage className={className} src={getAssetMediaUrl(id, scope, ASSET_THUMBNAIL_WIDTH)} alt={name} onDoubleClick={onDoubleClick} />;
}
