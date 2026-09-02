import { uploadAsset, type Asset } from "@/entities/asset";
import type { WorkspaceScope } from "@/shared/config";

import {
  DIRECTOR_PROTOCOL_VERSION,
  normalizeDirectorFrame,
  type DirectorFrameExport,
  type RequestDirector,
} from "../model/protocol";

export type ArchivedDirectorFrame = {
  frame: DirectorFrameExport;
  asset: Asset;
};

export type DirectorFrameArchiveDependencies = {
  upload: typeof uploadAsset;
};

const defaultDependencies: DirectorFrameArchiveDependencies = {
  upload: uploadAsset,
};

export async function archiveDirectorFrame(
  input: {
    requestDirector: RequestDirector;
    instanceId: string;
    canvasId: string;
    nodeId: string;
    hasCanvasTarget: boolean;
    scope: WorkspaceScope;
  },
  dependencies: DirectorFrameArchiveDependencies = defaultDependencies
): Promise<ArchivedDirectorFrame> {
  const data = await input.requestDirector("export.frame", {
    fileName: "director-frame.png",
    position: "current",
    quality: "720p",
  });
  const frame = normalizeDirectorFrame(data);
  if (!frame.dataUrl) throw new Error("导演台没有返回可上传的当前帧");
  const file = dataUrlToFile(
    frame.dataUrl,
    frame.fileName || "director-frame.png"
  );
  const asset = await dependencies.upload(
    file,
    {
      type: "image",
      category: "reference",
      source_type: "canvas",
      source_project_id: input.canvasId || input.instanceId,
      source_project_name: input.hasCanvasTarget
        ? "3D 导演台画布回写"
        : "3D 导演台",
      source_metadata: JSON.stringify({
        source: "3d-director-desk",
        instanceId: input.instanceId,
        canvasId: input.canvasId || undefined,
        nodeId: input.nodeId || undefined,
        protocolVersion: DIRECTOR_PROTOCOL_VERSION,
      }),
      name: frame.fileName || "director-frame.png",
      note: "3D director desk frame export",
    },
    input.scope
  );
  return { frame, asset };
}

export function dataUrlToFile(dataUrl: string, fileName: string) {
  const [meta = "", data = ""] = dataUrl.split(",");
  const type = meta.match(/^data:(.*?);base64$/)?.[1] || "image/png";
  const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
  return new File([bytes], fileName, { type });
}
