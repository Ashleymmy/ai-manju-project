import type { ImageGenerationInput } from "@/services/api/image";

export const IMAGE_WORKBENCH_SIZE_OPTIONS = [
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "1:1(2x)",
  "16:9(2x)",
  "9:16(2x)",
  "16:9(4k)",
  "9:16(4k)",
  "auto",
] as const;

export type ImageWorkbenchSizeOption = (typeof IMAGE_WORKBENCH_SIZE_OPTIONS)[number];
export type ImageWorkbenchQuality = NonNullable<ImageGenerationInput["quality"]>;

type ImageWorkbenchRequestOptions = {
  size: NonNullable<ImageGenerationInput["size"]>;
  quality: ImageWorkbenchQuality;
};

export function resolveImageWorkbenchRequestOptions(
  size: ImageWorkbenchSizeOption,
  quality: ImageWorkbenchQuality,
): ImageWorkbenchRequestOptions {
  switch (size) {
    case "1:1(2x)":
      return { size: "1:1", quality: "medium" };
    case "16:9(2x)":
      return { size: "16:9", quality: "medium" };
    case "9:16(2x)":
      return { size: "9:16", quality: "medium" };
    case "16:9(4k)":
      return { size: "16:9", quality: "high" };
    case "9:16(4k)":
      return { size: "9:16", quality: "high" };
    default:
      return { size, quality };
  }
}
