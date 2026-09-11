import { describe, expect, it } from "vitest";

import { isAssetFavorited, nextAssetReaction } from "./reactions";

describe("asset reactions", () => {
  it("toggles favorite on and off", () => {
    expect(nextAssetReaction(undefined, "favorite")).toBe("favorite");
    expect(nextAssetReaction("none", "favorite")).toBe("favorite");
    expect(nextAssetReaction("favorite", "favorite")).toBe("none");
  });

  it("replaces dislike when favoriting", () => {
    expect(nextAssetReaction("dislike", "favorite")).toBe("favorite");
    expect(isAssetFavorited("favorite")).toBe(true);
    expect(isAssetFavorited("none")).toBe(false);
  });
});
