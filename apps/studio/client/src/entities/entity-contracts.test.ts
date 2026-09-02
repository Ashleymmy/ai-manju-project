import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { announcementQueryKeys, invalidateAnnouncements } from "./announcement";
import {
  assetQueryKeys,
  invalidateAssetScope,
  invalidateSeedanceAsset,
  invalidateSeedanceAssets,
  invalidateSeedanceTags,
} from "./asset";
import { authQueryKeys, clearAuthCache, setCurrentAuthUser } from "./auth";
import { comicQueryKeys, invalidateComicProjects } from "./comic";
import { invalidateJobLists, jobQueryKeys } from "./job";
import { modelLabel, modelQueryKeys, normalizeModelList } from "./model";
import { projectQueryKeys } from "./project";
import { promptQueryKeys } from "./prompt";
import { invalidateTagScope, tagQueryKeys } from "./tag";

describe("entity query contracts", () => {
  it("keeps workspace scope and resource identity in cache keys", () => {
    expect(projectQueryKeys.snapshot("team", "project-1")).toEqual([
      "projects",
      "snapshot",
      "team",
      "project-1",
    ]);
    expect(assetQueryKeys.detail("personal", "asset-1")).toEqual([
      "assets",
      "detail",
      "personal",
      "asset-1",
    ]);
    expect(tagQueryKeys.assetBindings("team", "asset-1")).toEqual([
      "tags",
      "asset-bindings",
      "team",
      "asset-1",
    ]);
    expect(comicQueryKeys.batch("personal", "batch-1")).toEqual([
      "comic",
      "batch",
      "personal",
      "batch-1",
    ]);
  });

  it("keeps normalized list filters in job and prompt cache keys", () => {
    expect(
      jobQueryKeys.list({
        scope: "team",
        status: "running",
        page: 2,
        pageSize: 50,
      })
    ).toEqual([
      "jobs",
      "list",
      "team",
      { status: "running", limit: 50 },
    ]);
    expect(
      jobQueryKeys.list({
        scope: "team",
        status: "running",
        page: 2,
        pageSize: 50,
      })
    ).toEqual(
      jobQueryKeys.list({ scope: "team", status: "running", limit: 50 })
    );
    expect(
      promptQueryKeys.list(2, 24, { category: "分镜", tags: ["镜头"] })
    ).toEqual(["prompts", "list", 2, 24, { category: "分镜", tags: ["镜头"] }]);
    expect(promptQueryKeys.completeList()).not.toEqual(
      promptQueryKeys.list(1, 100)
    );
  });

  it("normalizes model descriptors without losing provider metadata labels", () => {
    expect(
      normalizeModelList([
        " provider::model-a ",
        { id: "provider::model-b" },
        { name: "provider::model-a" },
      ])
    ).toEqual(["provider::model-a", "provider::model-b"]);
    expect(
      modelLabel("provider::model-a", {
        labels: { "provider::model-a": "模型 A" },
        providerNames: { "provider::model-a": "供应商" },
      })
    ).toBe("模型 A · 供应商");
    expect(modelQueryKeys.capability("video")).toEqual([
      "models",
      "endpoint",
      "ai-models",
      "capability",
      "video",
      { includeGenericModels: true, normalizeMetadata: true },
    ]);
  });

  it("separates model projections with different normalization options", () => {
    expect(
      modelQueryKeys.capability("text", {
        includeGenericModels: true,
        normalizeMetadata: true,
      })
    ).not.toEqual(
      modelQueryKeys.capability("text", {
        includeGenericModels: false,
        normalizeMetadata: true,
      })
    );
    expect(
      modelQueryKeys.capability("text", {
        includeGenericModels: true,
        normalizeMetadata: true,
      })
    ).not.toEqual(
      modelQueryKeys.capability("text", {
        includeGenericModels: true,
        normalizeMetadata: false,
      })
    );
  });

  it("separates admin and mention Seedance endpoints", () => {
    const params = { status: "active", limit: 20 };
    expect(assetQueryKeys.seedanceAdmin(params)).not.toEqual(
      assetQueryKeys.seedanceMentions(params)
    );
  });

  it("keeps tag asset pages in separate cache entries", () => {
    expect(assetQueryKeys.tagAssets("team", "tag-1", 1, 24)).not.toEqual(
      assetQueryKeys.tagAssets("team", "tag-1", 2, 24)
    );
  });

  it("maps every composite entity read to its own cache identity", () => {
    expect(assetQueryKeys.lineage("team", "asset-1")).not.toEqual(
      assetQueryKeys.userState("team", "asset-1")
    );
    expect(assetQueryKeys.usageEvents("team", "asset-1")).not.toEqual(
      assetQueryKeys.detail("team", "asset-1")
    );
    expect(assetQueryKeys.exportDetail("team", "export-1")).not.toEqual(
      assetQueryKeys.exports("team")
    );
    expect(assetQueryKeys.seedanceReadiness()).not.toEqual(
      assetQueryKeys.seedanceTags()
    );
    expect(assetQueryKeys.seedanceAdminDetail("asset-1")).not.toEqual(
      assetQueryKeys.seedanceAdmin()
    );
    expect(tagQueryKeys.completeList("team", "asset")).not.toEqual(
      tagQueryKeys.list("team", { usage: "asset" })
    );
    expect(tagQueryKeys.promptBindings("team", "tag-1")).not.toEqual(
      tagQueryKeys.assetBindings("team", "tag-1")
    );
    expect(comicQueryKeys.analysisSession("team", "session-1")).not.toEqual(
      comicQueryKeys.project("team", "session-1")
    );
    expect(comicQueryKeys.batches("team", "project-1")).not.toEqual(
      comicQueryKeys.batch("team", "project-1")
    );
  });
});

describe("entity cache operations", () => {
  it("sets and clears the current auth user through the auth boundary", () => {
    const queryClient = new QueryClient();
    const user = {
      id: "user-1",
      username: "tester",
      role: "member" as const,
      status: "active",
    };

    setCurrentAuthUser(queryClient, user);
    expect(queryClient.getQueryData(authQueryKeys.currentUser())).toEqual(user);
    clearAuthCache(queryClient);
    expect(
      queryClient.getQueryData(authQueryKeys.currentUser())
    ).toBeUndefined();
  });

  it("invalidates announcement data through one public cache operation", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(announcementQueryKeys.current(), {
      id: "announcement-1",
    });
    await invalidateAnnouncements(queryClient);
    expect(
      queryClient.getQueryState(announcementQueryKeys.current())?.isInvalidated
    ).toBe(true);
  });

  it("invalidates job lists only inside the requested workspace scope", async () => {
    const queryClient = new QueryClient();
    const teamKey = jobQueryKeys.list({ scope: "team", status: "running" });
    const personalKey = jobQueryKeys.list({
      scope: "personal",
      status: "running",
    });
    const defaultScopeKey = jobQueryKeys.list({ status: "queued" });
    queryClient.setQueryData(teamKey, {});
    queryClient.setQueryData(personalKey, {});
    queryClient.setQueryData(defaultScopeKey, {});

    await invalidateJobLists(queryClient, "team");

    expect(queryClient.getQueryState(teamKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(personalKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(defaultScopeKey)?.isInvalidated).toBe(
      false
    );

    await invalidateJobLists(queryClient, "personal");

    expect(queryClient.getQueryState(personalKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(defaultScopeKey)?.isInvalidated).toBe(
      true
    );
  });

  it("invalidates every workspace asset projection", async () => {
    const queryClient = new QueryClient();
    const keys = [
      assetQueryKeys.list("team"),
      assetQueryKeys.library("team"),
      assetQueryKeys.trash("team"),
      assetQueryKeys.detail("team", "asset-1"),
      assetQueryKeys.lineage("team", "asset-1"),
      assetQueryKeys.userState("team", "asset-1"),
      assetQueryKeys.usageEvents("team", "asset-1"),
      assetQueryKeys.tagAssets("team", "tag-1"),
      assetQueryKeys.folders("team"),
      assetQueryKeys.exports("team"),
      assetQueryKeys.exportDetail("team", "export-1"),
    ];
    const personalKey = assetQueryKeys.detail("personal", "asset-1");
    keys.forEach(key => queryClient.setQueryData(key, {}));
    queryClient.setQueryData(personalKey, {});

    await invalidateAssetScope(queryClient, "team");

    keys.forEach(key => {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    });
    expect(queryClient.getQueryState(personalKey)?.isInvalidated).toBe(false);
  });

  it("invalidates Seedance list, detail, readiness, and tag projections", async () => {
    const queryClient = new QueryClient();
    const listKeys = [
      assetQueryKeys.seedanceAdmin({ status: "active" }),
      assetQueryKeys.seedanceMentions({ status: "active" }),
    ];
    const detailKey = assetQueryKeys.seedanceAdminDetail("asset-1");
    const readinessKey = assetQueryKeys.seedanceReadiness();
    const tagsKey = assetQueryKeys.seedanceTags();
    [...listKeys, detailKey, readinessKey, tagsKey].forEach(key =>
      queryClient.setQueryData(key, {})
    );

    await invalidateSeedanceAsset(queryClient, "asset-1");
    [...listKeys, detailKey].forEach(key => {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    });

    await invalidateSeedanceTags(queryClient);
    expect(queryClient.getQueryState(tagsKey)?.isInvalidated).toBe(true);

    await invalidateSeedanceAssets(queryClient);
    expect(queryClient.getQueryState(readinessKey)?.isInvalidated).toBe(true);
  });

  it("invalidates tag lists and asset bindings together", async () => {
    const queryClient = new QueryClient();
    const keys = [
      tagQueryKeys.legacyAssetList(),
      tagQueryKeys.list("personal"),
      tagQueryKeys.completeList("personal", "asset"),
      tagQueryKeys.promptBindings("personal", "tag-1"),
      tagQueryKeys.assetBindings("personal", "asset-1"),
    ];
    keys.forEach(key => queryClient.setQueryData(key, {}));

    await invalidateTagScope(queryClient, "personal");

    keys.forEach(key => {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    });
  });

  it("invalidates comic lists, project details, and batches together", async () => {
    const queryClient = new QueryClient();
    const keys = [
      comicQueryKeys.projects("personal"),
      comicQueryKeys.project("personal", "project-1"),
      comicQueryKeys.analysisSession("personal", "session-1"),
      comicQueryKeys.batches("personal", "project-1"),
      comicQueryKeys.batch("personal", "batch-1"),
    ];
    keys.forEach(key => queryClient.setQueryData(key, {}));

    await invalidateComicProjects(queryClient, "personal");

    keys.forEach(key => {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    });
  });
});
