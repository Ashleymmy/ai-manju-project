import { describe, expect, it } from "vitest";

import { createZip, readZip } from "./zip";

describe("zip", () => {
  it("round-trips canvas fragment JSON and binary media", async () => {
    const archive = await createZip([
      { name: "canvas-fragment.json", data: JSON.stringify({ version: 1, title: "选区" }) },
      { name: "assets/image.bin", data: new Uint8Array([1, 2, 3, 255]) },
    ]);
    const entries = await readZip(archive);
    expect(JSON.parse(await entries.get("canvas-fragment.json")!.text())).toEqual({ version: 1, title: "选区" });
    expect(Array.from(new Uint8Array(await entries.get("assets/image.bin")!.arrayBuffer()))).toEqual([1, 2, 3, 255]);
  });
});
