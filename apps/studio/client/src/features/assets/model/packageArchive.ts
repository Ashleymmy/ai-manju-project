import { BlobReader, BlobWriter, ZipReader, type FileEntry } from "@zip.js/zip.js";

// Payloads are read one at a time; only index/manifest metadata has an in-memory budget.
export const PACKAGE_MAX_METADATA_BYTES = 64 * 1024 * 1024;
export const PACKAGE_MAX_ASSETS = 100_000;
const PACKAGE_MAX_ZIP_ENTRIES = 200_000;
const PACKAGE_INDEX_YIELD_EVERY = 500;

class PackageBlobReader extends BlobReader {
  override async readUint8Array(offset: number, length: number) {
    if (length > PACKAGE_MAX_METADATA_BYTES) throw new Error("资产包目录索引过大，请按目录分包");
    return super.readUint8Array(offset, length);
  }
}

export function checkPackageCanceled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("导入已暂停，可继续导入", "AbortError");
}

/** ZIP64-aware random-access index. Never reads/decompresses the entire ZIP. */
export async function openPackageArchive(file: Blob, signal?: AbortSignal) {
  checkPackageCanceled(signal);
  const reader = new ZipReader(new PackageBlobReader(file), {
    useWebWorkers: false, checkCrc32: true, filenameValidation: "strict",
  });
  const entries = new Map<string, FileEntry>();
  const names = new Set<string>();
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      checkPackageCanceled(signal);
      if (names.size >= PACKAGE_MAX_ZIP_ENTRIES) throw new Error("资产包文件条目超过 20 万，请按目录分包");
      if (names.has(entry.filename)) throw new Error("资产包含有重复的文件路径");
      names.add(entry.filename);
      if (entry.encrypted) throw new Error("请先解密资产包，再导入");
      if (!entry.directory) entries.set(entry.filename, entry);
      if (names.size % PACKAGE_INDEX_YIELD_EVERY === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return entries;
  } finally {
    // BlobReader owns no open file handle. Entries retain their immutable source.
    await reader.close();
  }
}

/** Materialize only the current file, with CRC and exact decoded-length checks.
 * The output guard rejects a forged expansion size before retaining excess data. */
export async function readPackageEntry(entry: FileEntry, type: string, signal?: AbortSignal, onProgress?: (percent: number) => void) {
  checkPackageCanceled(signal);
  const output = new BlobWriter(type);
  const writer = output.writable.getWriter();
  let written = 0;
  const bounded = new WritableStream<Uint8Array>({
    async write(chunk) {
      checkPackageCanceled(signal);
      written += chunk.byteLength;
      if (written > entry.uncompressedSize) throw new Error("资产包文件解压大小不符");
      await writer.write(chunk);
    },
    close: () => writer.close(),
    abort: reason => writer.abort(reason),
  });
  try {
    await entry.getData(bounded, { signal, checkCrc32: true, useWebWorkers: false,
      onprogress: (current, total) => onProgress?.(total ? Math.floor(current / total * 100) : 0) });
    const blob = await output.getData();
    if (blob.size !== entry.uncompressedSize) throw new Error("资产包文件大小不符");
    return blob;
  } catch (error) {
    await writer.abort(error).catch(() => undefined);
    checkPackageCanceled(signal);
    throw new Error(`资产包文件损坏或校验失败：${entry.filename}`);
  } finally {
    writer.releaseLock();
  }
}
