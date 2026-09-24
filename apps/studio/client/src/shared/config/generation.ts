/** Canvas fans out one image per job; this is a product batch limit, not a model's n limit. */
export const MAX_IMAGE_GENERATION_COUNT = 15;
/** Keep the canvas's original quick choices; saved batches still retain their supported count. */
export const IMAGE_GENERATION_COUNTS = [1, 2, 4, 6] as const;
