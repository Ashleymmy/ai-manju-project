import { useEffect, useState } from "react";

import { getAssetContentObjectUrl } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";

/* 项目封面缩略图拉取尺寸（px 长边）：卡片视觉区宽度约 280–460px，640 足够清晰 */
const PROJECT_COVER_THUMB_SIZE = 640;

type CoverCarrier = { id: string; cover_asset_id?: string };

/**
 * 为带 cover_asset_id 的项目批量拉取封面 object URL。
 * 返回 Record<projectId, url>；依赖变化或卸载时自动回收上一批 URL。
 */
export function useProjectCoverUrls(projects: CoverCarrier[], scope: WorkspaceScope) {
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  /* 聚合 id:cover 对作为依赖 key，避免父组件每次渲染都重建数组导致重复拉取 */
  const coverKey = projects.map((project) => `${project.id}:${project.cover_asset_id || ""}`).join("|");

  useEffect(() => {
    const targets = projects.filter((project) => project.cover_asset_id);
    if (!targets.length) {
      setCoverUrls({});
      return;
    }
    let disposed = false;
    const urls: Record<string, string> = {};
    Promise.all(targets.map(async (project) => {
      try {
        const url = await getAssetContentObjectUrl(project.cover_asset_id as string, scope, PROJECT_COVER_THUMB_SIZE);
        if (disposed) URL.revokeObjectURL(url);
        else urls[project.id] = url;
      } catch {
        undefined;
      }
    })).then(() => { if (!disposed) setCoverUrls(urls); });
    return () => {
      disposed = true;
      Object.values(urls).forEach(URL.revokeObjectURL);
    };
    // coverKey 已完整表达 projects 里影响封面的部分
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverKey, scope]);

  return coverUrls;
}
