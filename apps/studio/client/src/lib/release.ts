export type ReleaseInfo = {
  version: string;
  date: string;
  items: { type: string; content: string }[];
};

/** 解析 CHANGELOG.md：`## 版本 - 日期` 段落 + `+ [类型] 内容` 条目。 */
export function parseChangelog(content: string): ReleaseInfo[] {
  return content
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const [title = "", ...lines] = block.trim().split("\n");
      const [, version = title.trim(), date = ""] = title.match(/^(.+?)(?:\s+-\s+(.+))?$/) || [];
      return {
        version: version.trim(),
        date: date.trim(),
        items: lines
          .map((line) => line.trim().match(/^\+\s+\[(.+?)\]\s+(.+)$/))
          .filter((match): match is RegExpMatchArray => Boolean(match))
          .map((match) => ({ type: match[1], content: match[2] })),
      };
    })
    .filter((release) => release.items.length);
}

const SEEN_RELEASE_STORAGE_KEY = "ai-manju:seen_release";

export function seenReleaseVersion() {
  try {
    return window.localStorage.getItem(SEEN_RELEASE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function markReleaseSeen(version: string) {
  try {
    window.localStorage.setItem(SEEN_RELEASE_STORAGE_KEY, version);
  } catch {
    undefined;
  }
}

/** 首次见到最新版本时才提示；已读或无发布记录返回 null。 */
export function pendingRelease(releases: ReleaseInfo[]) {
  const latest = releases[0];
  if (!latest) return null;
  return seenReleaseVersion() === latest.version ? null : latest;
}
