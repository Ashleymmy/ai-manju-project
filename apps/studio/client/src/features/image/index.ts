// 由路由层统一负责 React.lazy() 代码分割；这里导出具体组件，避免
// feature 入口再次嵌套 lazy，导致路由模块默认导出无法被 React 解析。
export { ImageWorkbenchView } from "./ImagePage";
export { default } from "./ImagePage";
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
