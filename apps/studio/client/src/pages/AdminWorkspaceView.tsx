// 兼容旧页面入口；真实实现由 Admin feature 所有，统一在 REFACTOR-019 清理。
export { default } from "@/features/admin";
export {
  adminTabFromLocation,
  buildSeedanceAssetListParams,
  clearProviderSensitiveInputState,
  paginateSeedanceAssets,
} from "@/features/admin/ui/AdminWorkspaceView";
