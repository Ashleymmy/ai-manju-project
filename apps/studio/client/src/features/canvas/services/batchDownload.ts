import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import type { WorkspaceScope } from "@/shared/config";
import { assetIdFromNode, imageSrcFromNode } from "../domain/nodes";
import { mediaFileName, mediaKindFromNode } from "../domain/nodeUtils";
import type { CanvasNodeData } from "../domain/types";
import { downloadCanvasOriginalMedia } from "./originalMedia";

// Serial reads avoid loading every original at once. ZIP64 is selected by the
// library when required; media is stored unchanged without recompression.
const DOWNLOAD_FAILURE_REPORT = "下载失败说明.txt";
type Failure = { name: string; error: string };
export type CanvasBatchDownloadProgress = { completed: number; total: number; name: string };

export function downloadableCanvasNodes(nodes: readonly CanvasNodeData[], selectedIds: ReadonlySet<string>) {
  return nodes.filter(node => selectedIds.has(node.id)
    && (node.kind === "image" || node.kind === "video" || node.kind === "audio")
    && Boolean(assetIdFromNode(node) || imageSrcFromNode(node, {})));
}

function uniqueFileName(node: CanvasNodeData, type: string, used: Set<string>) {
  const original = mediaFileName(node.title || node.id, mediaKindFromNode(node), type).replace(/[\u0000-\u001f]/g, "-");
  const dot = original.lastIndexOf(".");
  const stem = original.slice(0, dot), extension = original.slice(dot);
  let name = original, copy = 1;
  while (used.has(name.toLocaleLowerCase())) name = `${stem} (${++copy})${extension}`;
  used.add(name.toLocaleLowerCase());
  return name;
}

export async function createCanvasSelectionDownload(
  nodes: readonly CanvasNodeData[], selectedIds: ReadonlySet<string>, scope: WorkspaceScope | null,
  onProgress: (progress: CanvasBatchDownloadProgress) => void,
  readOriginal = downloadCanvasOriginalMedia,
) {
  const selected = downloadableCanvasNodes(nodes, selectedIds);
  if (!selected.length) throw new Error("所选节点没有可下载的图片、视频或音频");
  const skipped = nodes.filter(node => selectedIds.has(node.id)).length - selected.length;
  const writer = new ZipWriter(new BlobWriter("application/zip"), { level: 0, useWebWorkers: false });
  const names = new Set<string>([DOWNLOAD_FAILURE_REPORT]);
  const failures: Failure[] = [];
  let completed = 0;
  try {
    for (const node of selected) {
      onProgress({ completed, total: selected.length, name: node.title || node.id });
      let blob: Blob;
      try { blob = await readOriginal(node, scope); }
      catch (error) {
        failures.push({ name: node.title || node.id, error: error instanceof Error ? error.message : "读取失败" });
        continue;
      }
      // ZIP write errors abort the archive; only source read errors can be
      // isolated safely without risking a corrupt downloadable file.
      await writer.add(uniqueFileName(node, blob.type, names), new BlobReader(blob));
      completed++;
    }
    if (!completed) throw new Error(`所选媒体均下载失败：${failures[0]?.error || "原文件不可用"}`);
    if (failures.length) {
      const report = failures.map(failure => `${failure.name}：${failure.error}`).join("\n");
      await writer.add(DOWNLOAD_FAILURE_REPORT, new BlobReader(new Blob([report], { type: "text/plain;charset=utf-8" })));
    }
    const blob = await writer.close();
    onProgress({ completed, total: selected.length, name: "" });
    return { blob, completed, skipped, failures };
  } catch (error) {
    await writer.close().catch(() => {});
    throw error;
  }
}
