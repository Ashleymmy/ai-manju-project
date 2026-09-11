import type { AssetUserState } from "@/entities/asset";

/** 再次点同一反应则取消，否则切换到目标反应 */
export function nextAssetReaction(
  current: AssetUserState["reaction"] | undefined,
  target: "favorite" | "dislike",
): AssetUserState["reaction"] {
  return current === target ? "none" : target;
}

export function isAssetFavorited(reaction: AssetUserState["reaction"] | undefined) {
  return reaction === "favorite";
}
