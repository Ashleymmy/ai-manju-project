import { describe, expect, it, vi } from "vitest";
import { isCanvasImportCandidate, prepareCanvasImportImage, sniffImageType, type CanvasImageCodec } from "./importImage";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16];
const ascii = (text: string) => Array.from(text, char => char.charCodeAt(0));
const WEBP = [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPVP8 ")];
const ftyp = (major: string, ...compatible: string[]) => {
  const size = 16 + compatible.length * 4;
  return [0, 0, 0, size, ...ascii("ftyp"), ...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii)];
};
const bytes = (values: number[]) => new Uint8Array(values);
const file = (values: number[], name: string, type = "") => new File([bytes(values)], name, { type });
const codec = (overrides: Partial<CanvasImageCodec> = {}): CanvasImageCodec => ({
  decode: vi.fn(async () => ({ width: 1080, height: 1920 })),
  convert: vi.fn(async () => new Blob(["converted"], { type: "image/webp" })),
  ...overrides,
});

describe("canvas image import", () => {
  it("recognizes real formats regardless of the file label", () => {
    expect(sniffImageType(bytes(PNG))).toBe("image/png");
    expect(sniffImageType(bytes(JPEG))).toBe("image/jpeg");
    expect(sniffImageType(bytes([...ascii("GIF89a"), 1, 0]))).toBe("image/gif");
    expect(sniffImageType(bytes(WEBP))).toBe("image/webp");
    expect(sniffImageType(bytes([...ascii("BM"), 0, 0, 0, 0]))).toBe("image/bmp");
    expect(sniffImageType(bytes([...ascii("II*"), 0, 8, 0]))).toBe("image/tiff");
    expect(sniffImageType(bytes(ftyp("avif", "mif1", "miaf")))).toBe("image/avif");
    expect(sniffImageType(bytes(ftyp("mif1", "avif")))).toBe("image/avif");
    expect(sniffImageType(bytes(ftyp("heic", "mif1")))).toBe("image/heic");
    expect(sniffImageType(bytes(ftyp("isom", "mp42")))).toBe("");
    expect(sniffImageType(new TextEncoder().encode("\uFEFF <?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"/>"))).toBe("image/svg+xml");
    expect(sniffImageType(new TextEncoder().encode("hello"))).toBe("");
  });

  it("inspects unlabelled files but leaves documents alone", () => {
    expect(isCanvasImportCandidate(file(PNG, "微信图片"))).toBe(true);
    expect(isCanvasImportCandidate(file(PNG, "a.bin", "application/octet-stream"))).toBe(true);
    expect(isCanvasImportCandidate(file(PNG, "a.mp4", "video/mp4"))).toBe(true);
    expect(isCanvasImportCandidate(file(PNG, "a.txt", "text/plain"))).toBe(false);
  });

  it("relabels mislabelled or extensionless web-safe images without re-encoding", async () => {
    const images = codec();
    const webpAsJpg = await prepareCanvasImportImage(file(WEBP, "入秋穿搭.jpg", "image/jpeg"), images);
    expect(webpAsJpg).toMatchObject({ width: 1080, height: 1920, converted: false });
    expect(webpAsJpg.file).toMatchObject({ name: "入秋穿搭.webp", type: "image/webp" });

    const unlabelled = await prepareCanvasImportImage(file(JPEG, "1"), images);
    expect(unlabelled.file).toMatchObject({ name: "1.jpg", type: "image/jpeg" });

    const original = file(PNG, "ok.png", "image/png");
    expect((await prepareCanvasImportImage(original, images)).file).toBe(original);
    expect(images.convert).not.toHaveBeenCalled();
  });

  it("converts decodable formats the asset API does not store", async () => {
    const images = codec();
    const result = await prepareCanvasImportImage(file(ftyp("avif", "mif1"), "sticker.avif", "image/avif"), images);
    expect(images.convert).toHaveBeenCalledWith(expect.any(File), 1080, 1920);
    expect(result).toMatchObject({ width: 1080, height: 1920, converted: true });
    expect(result.file).toMatchObject({ name: "sticker.webp", type: "image/webp" });

    const pngFallback = codec({ convert: vi.fn(async () => new Blob(["png"], { type: "image/png" })) });
    expect((await prepareCanvasImportImage(file([...ascii("BM"), 0, 0], "scan.bmp", "image/bmp"), pngFallback)).file.name).toBe("scan.png");
  });

  it("rejects unreadable images with an actionable reason instead of creating a broken node", async () => {
    const undecodable = codec({ decode: vi.fn(async () => { throw new Error("decode"); }) });
    await expect(prepareCanvasImportImage(file(ftyp("heic", "mif1"), "IMG_0001.HEIC", "image/heic"), undecodable))
      .rejects.toThrow("HEIC/HEIF（苹果相册）格式浏览器无法读取，请先转换为 JPG 或 PNG 后再导入");
    await expect(prepareCanvasImportImage(file(PNG, "broken.png", "image/png"), undecodable))
      .rejects.toThrow("图片无法读取，文件可能已损坏或没有下载完整");
    await expect(prepareCanvasImportImage(file(ascii("hello"), "notes"), codec()))
      .rejects.toThrow("不是可识别的图片文件");
    await expect(prepareCanvasImportImage(new File([], "empty.png", { type: "image/png" }), codec()))
      .rejects.toThrow("文件为空");
    const zeroSize = codec({ decode: vi.fn(async () => ({ width: 0, height: 0 })) });
    await expect(prepareCanvasImportImage(file(PNG, "zero.png", "image/png"), zeroSize)).rejects.toThrow("图片无法读取");
    const failedConvert = codec({ convert: vi.fn(async () => { throw new Error("encode"); }) });
    await expect(prepareCanvasImportImage(file([...ascii("II*"), 0], "a.tiff", "image/tiff"), failedConvert))
      .rejects.toThrow("TIFF格式转换失败");
  });
});
