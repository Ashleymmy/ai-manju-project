import { describe, expect, it } from "vitest";

import { COMIC_TEMPLATE_FILE_MAX_BYTES } from "../model/constants";
import { readComicTemplateFile } from "./ComicTemplateFields";

describe("readComicTemplateFile", () => {
  it("reads UTF-8 text and strips the BOM and outer whitespace", async () => {
    const file = new File(["\uFEFF  {{美术风格}} 人物  \n"], "人物.txt");
    await expect(readComicTemplateFile(file)).resolves.toBe("{{美术风格}} 人物");
  });

  it("falls back to GB18030 for TXT files saved by Windows editors", async () => {
    // "人物模板" encoded as GBK.
    const gbk = new Uint8Array([0xc8, 0xcb, 0xce, 0xef, 0xc4, 0xa3, 0xb0, 0xe5]);
    const file = new File([gbk], "template.TXT");
    await expect(readComicTemplateFile(file)).resolves.toBe("人物模板");
  });

  it("rejects non-TXT, empty and oversized files", async () => {
    await expect(readComicTemplateFile(new File(["x"], "模板.docx"))).rejects.toThrow("TXT");
    await expect(readComicTemplateFile(new File(["  \n "], "空.txt"))).rejects.toThrow("为空");
    const large = new File([new Uint8Array(COMIC_TEMPLATE_FILE_MAX_BYTES + 1).fill(0x61)], "大.txt");
    await expect(readComicTemplateFile(large)).rejects.toThrow("不能超过");
  });
});
