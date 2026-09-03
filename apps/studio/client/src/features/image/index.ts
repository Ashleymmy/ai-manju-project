import { lazy } from "react";

// Keep the public feature entry light so consumers of the typed image API do
// not pull the full workbench (and its prompt dialog) into their route chunk.
const ImageWorkbenchView = lazy(() => import("./ImagePage"));

export { ImageWorkbenchView };
export default ImageWorkbenchView;
export {
  fetchImageModels,
  fetchTextModels,
  generateImages,
  generatedImagesFromJob,
  imageModelLabel,
  publicApiError,
  submitImageEdit,
  submitImageGeneration,
  waitForImageJob,
} from "./api";
export type {
  AiModelsResponse,
  GeneratedImage,
  GenerationCallbacks,
  ImageGenerationInput,
  ImageModelCatalog,
  TextModelCatalog,
} from "./api";
export {
  IMAGE_WORKBENCH_SIZE_OPTIONS,
  resolveImageWorkbenchRequestOptions,
} from "./model/options";
export type {
  ImageWorkbenchQuality,
  ImageWorkbenchSizeOption,
} from "./model/options";
export {
  useImageAssetPickerQuery,
  useImageHistoryQuery,
  useImageModelCatalogQuery,
} from "./model/queries";
