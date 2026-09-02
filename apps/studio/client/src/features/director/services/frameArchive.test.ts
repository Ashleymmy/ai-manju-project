import { describe, expect, it, vi } from "vitest";

import type { Asset } from "@/entities/asset";

import type { RequestDirector } from "../model/protocol";
import {
  archiveDirectorFrame,
  type DirectorFrameArchiveDependencies,
} from "./frameArchive";

const archivedAsset: Asset = {
  id: "asset-frame",
  type: "image",
  name: "camera.webp",
  size: 5,
  content_type: "image/webp",
};

describe("Director frame archive", () => {
  it("requests the current frame and preserves upload lineage metadata", async () => {
    const requestDirector = vi.fn<RequestDirector>(async () => ({
      data_url: "data:image/webp;base64,aGVsbG8=",
      width: 1920,
      height: 1080,
      file_name: "camera.webp",
    }));
    const upload = vi.fn<DirectorFrameArchiveDependencies["upload"]>(
      async () => archivedAsset
    );

    await expect(
      archiveDirectorFrame(
        {
          requestDirector,
          instanceId: "director-instance",
          canvasId: "canvas-1",
          nodeId: "director-node",
          hasCanvasTarget: true,
          scope: "team",
        },
        { upload }
      )
    ).resolves.toEqual({
      frame: {
        dataUrl: "data:image/webp;base64,aGVsbG8=",
        width: 1920,
        height: 1080,
        fileName: "camera.webp",
      },
      asset: archivedAsset,
    });

    expect(requestDirector).toHaveBeenCalledWith("export.frame", {
      fileName: "director-frame.png",
      position: "current",
      quality: "720p",
    });
    expect(upload).toHaveBeenCalledOnce();
    const [file, metadata, scope] = upload.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("camera.webp");
    expect(file.type).toBe("image/webp");
    expect(file.size).toBe(5);
    expect(scope).toBe("team");
    expect(metadata).toMatchObject({
      type: "image",
      category: "reference",
      source_type: "canvas",
      source_project_id: "canvas-1",
      source_project_name: "3D 导演台画布回写",
      name: "camera.webp",
      note: "3D director desk frame export",
    });
    expect(JSON.parse(metadata.source_metadata)).toEqual({
      source: "3d-director-desk",
      instanceId: "director-instance",
      canvasId: "canvas-1",
      nodeId: "director-node",
      protocolVersion: 1,
    });
  });

  it("uses the instance as standalone lineage and rejects missing frame data", async () => {
    const upload = vi.fn<DirectorFrameArchiveDependencies["upload"]>(
      async () => archivedAsset
    );
    const requestDirector = vi.fn<RequestDirector>(async () => ({
      dataUrl: "data:image/png;base64,AA==",
    }));
    await archiveDirectorFrame(
      {
        requestDirector,
        instanceId: "director-instance",
        canvasId: "",
        nodeId: "",
        hasCanvasTarget: false,
        scope: "personal",
      },
      { upload }
    );
    expect(upload.mock.calls[0][1]).toMatchObject({
      source_project_id: "director-instance",
      source_project_name: "3D 导演台",
    });
    expect(JSON.parse(upload.mock.calls[0][1].source_metadata)).toEqual({
      source: "3d-director-desk",
      instanceId: "director-instance",
      protocolVersion: 1,
    });

    const missingFrameRequest = vi.fn<RequestDirector>(async () => ({}));
    await expect(
      archiveDirectorFrame(
        {
          requestDirector: missingFrameRequest,
          instanceId: "director-instance",
          canvasId: "",
          nodeId: "",
          hasCanvasTarget: false,
          scope: "personal",
        },
        { upload }
      )
    ).rejects.toThrow("导演台没有返回可上传的当前帧");
    expect(upload).toHaveBeenCalledOnce();
  });
});
