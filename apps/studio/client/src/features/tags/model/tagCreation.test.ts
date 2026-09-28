import { afterEach, describe, expect, it, vi } from "vitest";
import type { SemanticTag } from "@/entities/tag";
import { ApiError } from "@/shared/api/errors";
import { createTagAttemptKey, findTagNameConflict, isTagNameConflict, normalizeTagName, tagCreationError } from "./tagCreation";

const tag = { id: "b", name: "B  label", scope_type: "workspace", parent_id: "", editable: true } as SemanticTag;

describe("tag creation", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("works on HTTP origins without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {});
    const first = createTagAttemptKey();
    expect(first).toMatch(/^tag_/);
    expect(createTagAttemptKey()).not.toBe(first);
  });
  it("matches sibling names with the server's case and whitespace rules", () => {
    expect(normalizeTagName("  B\u0085\tlabel \n")).toBe("B label");
    expect(findTagNameConflict([tag], " b label ", "", "workspace")).toBe(tag);
  });
  it.each([
    { ...tag, name: "another" },
    { ...tag, parent_id: "parent" },
    { ...tag, scope_type: "user" },
    { ...tag, editable: false },
  ])("does not reject a different name, parent or ownership: %j", candidate => {
    expect(findTagNameConflict([candidate as SemanticTag], "b label", "", "workspace")).toBeUndefined();
  });
  it("recognizes archived siblings so the user can explicitly restore them", () => {
    const archived = { ...tag, status: "archived" } as SemanticTag;
    expect(findTagNameConflict([archived], "B label", "", "workspace")).toBe(archived);
  });
  it("handles only name conflicts as duplicate tags", () => {
    expect(isTagNameConflict(new ApiError("tag already exists", 409))).toBe(true);
    expect(isTagNameConflict(new ApiError("tag is read-only", 409))).toBe(false);
    expect(isTagNameConflict(new Error("tag already exists"))).toBe(false);
  });
  it.each([
    [new ApiError("tag already exists", 409, "private-request"), "创建标签时发生冲突，已保留输入"],
    [new ApiError("tag parent is invalid", 400), "所选父级不可用"],
    [new ApiError("tag scope is invalid", 400), "仅自己可见的标签只能用于提示词"],
    [new ApiError("tag name is too long", 400), "最多 64 个字符"],
    [new ApiError("network failure", 0), "相同内容不会重复创建"],
    [new ApiError("internal SQL detail", 500), "创建标签失败"],
  ])("provides actionable public feedback", (error, message) => {
    expect(tagCreationError(error)).toContain(message);
    expect(tagCreationError(error)).not.toMatch(/request|SQL/);
  });
});
