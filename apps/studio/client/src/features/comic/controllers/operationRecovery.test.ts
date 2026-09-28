import { describe, expect, it } from "vitest";
import { ApiError } from "@/shared/api/http";
import { comicRetainedCandidate } from "./operationRecovery";

describe("retained comic output", () => {
  const error = (recovery: unknown, status = 409) => new ApiError("conflict", status, undefined, { data: { recovery }, unrelated: "private envelope" });
  it("extracts the original prompt without displaying other error fields", () => {
    expect(comicRetainedCandidate(error({ status: "conflict", kind: "comic_prompt", candidate: { prompt: { asset: { draft_prompt: "original result", name: "actor" } } } })))
      .toEqual({ title: "已保留的提示词", content: "original result" });
  });
  it("retains reviewable analysis candidates without adopting a stale revision", () => {
    const candidate = { assets: [{ name: "actor", source_prompt: "blue coat" }] };
    const retained = comicRetainedCandidate(error({ status: "conflict", kind: "comic_revision", candidate: { revision: { candidate, session_id: "old-session" } } }));
    expect(JSON.parse(retained!.content)).toEqual(candidate);
    expect(retained!.content).not.toContain("old-session");
  });
  it("ignores unverified, ordinary and malformed errors", () => {
    expect(comicRetainedCandidate(new Error("outage"))).toBeUndefined();
    expect(comicRetainedCandidate(error({ status: "applied", kind: "comic_prompt", candidate: {} }))).toBeUndefined();
    expect(comicRetainedCandidate(error({ status: "conflict", kind: "comic_prompt", candidate: {} }))).toBeUndefined();
    expect(comicRetainedCandidate(error({ status: "conflict", kind: "text" }))).toBeUndefined();
  });
});
