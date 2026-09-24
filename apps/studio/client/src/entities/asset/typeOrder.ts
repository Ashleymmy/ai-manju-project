/** Shared order for material menus. Same-type entries keep their existing order. */
export const ASSET_TYPE_ORDER: Readonly<Record<string, number>> = { text: 0, image: 1, video: 2, audio: 3 };
/** Server applies type order before pagination, then newest first within a type. */
export const ASSET_TYPE_LIBRARY_SORT = "type_created_at_desc" as const;
export function compareAssetTypes(left: string, right: string) {
  return (ASSET_TYPE_ORDER[left] ?? 4) - (ASSET_TYPE_ORDER[right] ?? 4);
}
