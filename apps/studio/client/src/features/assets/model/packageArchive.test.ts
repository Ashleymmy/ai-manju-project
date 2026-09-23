import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { readAssetPackageContents } from "./assetPackage";
import { openPackageArchive, readPackageEntry } from "./packageArchive";

const encode = (text: string) => new TextEncoder().encode(text);
const metadata = (count: number) => ({
  app: "ai-manju-studio", version: 2,
  assets: Array.from({ length: count }, (_, i) => ({ id: `a${i}`, name: `${i}.png`, type: "image" })),
  files: Array.from({ length: count }, (_, i) => ({ assetId: `a${i}`, path: `${i}.png`, mimeType: "image/png", bytes: 3 })),
});

describe("bounded asset ZIP import", () => {
  it("indexes 10,001 assets without reading or retaining all media", async () => {
    const manifest = metadata(10001);
    const data = zipSync(Object.fromEntries([
      ["assets.json", encode(JSON.stringify(manifest))],
      ...manifest.files.map(file => [file.path, new Uint8Array([1, 2, 3])]),
    ]), { level: 0 });
    const blob = new Blob([data]);
    const wholeRead = vi.spyOn(blob, "arrayBuffer").mockRejectedValue(new Error("whole ZIP read forbidden"));
    const contents = await readAssetPackageContents(blob);
    expect(contents.items).toHaveLength(10001);
    expect(contents.items.every(item => item.file === undefined && item.readFile)).toBe(true);
    expect(wholeRead).not.toHaveBeenCalled();
    const last = await contents.items.at(-1)!.readFile!();
    expect(new Uint8Array(await last.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(contents.items.at(-1)!.file).toBeUndefined();
  });

  it("reads ZIP64 offsets above 4 GiB using bounded slices", async () => {
    // A sparse immutable Blob models a >4 GiB file without allocating its padding.
    const prefix = 2 ** 32 + 256;
    const writer = new ZipWriter(new BlobWriter(), { offset: prefix, zip64: true, useWebWorkers: false });
    await writer.add("assets.json", new TextReader("{}"), { level: 0 });
    const tail = await writer.close();
    class SparseBlob extends Blob {
      override get size() { return prefix + tail.size; }
      override arrayBuffer(): Promise<ArrayBuffer> { throw new Error("whole ZIP read forbidden"); }
      override slice(start = 0, end = this.size) {
        if (end - start > 1024 * 1024) throw new Error("unbounded read");
        const padding = Math.max(0, Math.min(end, prefix) - start);
        return new Blob([new Uint8Array(padding), tail.slice(Math.max(0, start - prefix), Math.max(0, end - prefix))]);
      }
    }
    const entries = await openPackageArchive(new SparseBlob());
    const entry = entries.get("assets.json")!;
    expect(entry.offset).toBeGreaterThan(2 ** 32);
    expect(await (await readPackageEntry(entry, "application/json")).text()).toBe("{}");
  });

  it("decompresses deflated files only when requested", async () => {
    const manifest = metadata(1);
    const blob = new Blob([zipSync({ "assets.json": encode(JSON.stringify(manifest)), "0.png": new Uint8Array([1, 2, 3]) })]);
    const contents = await readAssetPackageContents(blob);
    expect(contents.items[0].file).toBeUndefined();
    expect(new Uint8Array(await (await contents.items[0].readFile!()).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("rejects a bad CRC instead of uploading corrupted bytes", async () => {
    const data = zipSync({ "0.png": new Uint8Array([1, 2, 3]) }, { level: 0 });
    const view = new DataView(data.buffer);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    data[start] ^= 0xff;
    const entry = (await openPackageArchive(new Blob([data]))).get("0.png")!;
    await expect(readPackageEntry(entry, "image/png")).rejects.toThrow("校验失败");
  });

  it("stops extraction during a read and permits rereading after resume", async () => {
    const data = new Uint8Array(1024 * 1024);
    const entry = (await openPackageArchive(new Blob([zipSync({ "a.png": data }, { level: 0 })]))).get("a.png")!;
    const controller = new AbortController();
    await expect(readPackageEntry(entry, "image/png", controller.signal, () => controller.abort())).rejects.toMatchObject({ name: "AbortError" });
    expect((await readPackageEntry(entry, "image/png")).size).toBe(data.length);
  });
});
