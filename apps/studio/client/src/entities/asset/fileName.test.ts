import { expect, it } from "vitest";
import { assetDownloadFileName } from "./fileName";
it.each([
  ["image", "image/png", "新名称", "新名称.png"],
  ["image", "image/png", "女王的毒苹果（1）", "女王的毒苹果（1）.png"],
  ["video", "video/mp4", "镜头1（2）", "镜头1（2）.mp4"],
  ["video", "video/mp4", "镜头1.2", "镜头1.2.mp4"],
  ["audio", "audio/wav", "台词（2）", "台词（2）.wav"],
  ["audio", "audio/mp4", "音乐", "音乐.m4a"],
  ["image", "image/jpeg", "已有.JPG", "已有.JPG"],
] as const)("keeps renamed %s downloads usable", (type, content_type, name, expected) => {
  expect(assetDownloadFileName({ type, content_type, name })).toBe(expected);
});
