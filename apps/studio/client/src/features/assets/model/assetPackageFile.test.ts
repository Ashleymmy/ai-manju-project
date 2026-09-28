import { describe, expect, it } from "vitest";
import { isAssetPackageFile } from "./assetPackageFile";

describe("asset package upload routing", () => {
  it.each([
    ["assets.zip", "application/zip"],
    ["assets.ZIP", ""],
    ["assets.Zip", "application/octet-stream"],
    ["素材包.zip", ""],
    ["download", "application/zip"],
    ["download", "application/x-zip"],
    ["download", "application/x-zip-compressed"],
    ["download", "APPLICATION/ZIP"],
  ])("routes %s (%s) through package validation", (name, type) => {
    expect(isAssetPackageFile({ name, type })).toBe(true);
  });

  it.each([
    ["image.png", "image/png"],
    ["video.mp4", "video/mp4"],
    ["audio.mp3", "audio/mpeg"],
    ["image.zip.png", "image/png"],
    ["download", "application/octet-stream"],
    ["document.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ])("does not treat %s (%s) as an asset package", (name, type) => {
    expect(isAssetPackageFile({ name, type })).toBe(false);
  });
});
