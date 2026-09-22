import { unzip, zipSync } from "fflate";

type ZipReadLimits = { maxBytes: number; maxExpandedBytes: number; maxEntries: number };
// Asset import limits bound untrusted payloads without changing canvas ZIP limits.
export const ASSET_PACKAGE_ZIP_LIMITS: ZipReadLimits = { maxBytes: 512 * 1024 * 1024, maxExpandedBytes: 1024 * 1024 * 1024, maxEntries: 20000 };

type ZipFile = {
  name: string;
  data: BlobPart;
};

export async function createZip(files: ZipFile[]) {
  const entries = await Promise.all(files.map(async (file) => {
    const data = new Uint8Array(await new Blob([file.data]).arrayBuffer());
    return [file.name, data] as const;
  }));
  return new Blob([zipSync(Object.fromEntries(entries), { level: 0 })], { type: "application/zip" });
}

export async function readZip(file: Blob, limits?: ZipReadLimits) {
  if (limits && file.size > limits.maxBytes) throw new Error("资产包超过 512 MB，请分目录导出后导入");
  const data = new Uint8Array(await file.arrayBuffer());
  let expanded = 0;
  let count = 0;
  let oversized = false;
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(data, { filter: entry => {
      expanded += entry.originalSize;
      count += 1;
      oversized ||= Boolean(limits && (expanded > limits.maxExpandedBytes || count > limits.maxEntries));
      return !oversized;
    } }, (error, result) => {
      if (oversized) reject(new Error("资产包解压后过大或文件过多，请分目录导入"));
      else if (error) reject(new Error("无法解压资产包，文件可能已损坏"));
      else resolve(result);
    });
  });
  return new Map(Object.entries(entries).map(([name, data]) => [name, new Blob([data])]));
}
