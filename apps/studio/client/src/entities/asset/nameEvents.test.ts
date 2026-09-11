// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { publishAssetNameChange, subscribeAssetNameChanges } from "./nameEvents";

describe("asset name events", () => {
  it("notifies same-document subscribers immediately", () => {
    const received: Array<{ assetId: string; name: string; scope: string }> = [];
    const stop = subscribeAssetNameChanges(message => received.push(message));
    publishAssetNameChange({ assetId: "asset-1", name: "水果摊", scope: "personal" });
    expect(received).toEqual([{ assetId: "asset-1", name: "水果摊", scope: "personal" }]);
    stop();
  });
});
