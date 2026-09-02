import { describe, expect, it } from "vitest";

import { paginateStoredVideoHistory } from "./historyRepository";

describe("video history pagination", () => {
  const items = Array.from({ length: 45 }, (_, index) => `history-${index + 1}`);

  it("分页展示而不截断完整历史", () => {
    expect(paginateStoredVideoHistory(items, 1, 20)).toMatchObject({ items: items.slice(0, 20), page: 1, pageCount: 3 });
    expect(paginateStoredVideoHistory(items, 3, 20)).toMatchObject({ items: items.slice(40), page: 3, pageCount: 3 });
  });

  it("页码越界时归一化到有效页", () => {
    expect(paginateStoredVideoHistory(items, 99, 20).page).toBe(3);
    expect(paginateStoredVideoHistory(items, 0, 20).page).toBe(1);
  });
});
