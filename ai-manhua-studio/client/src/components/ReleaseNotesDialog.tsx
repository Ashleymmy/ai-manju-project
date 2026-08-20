import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import changelogRaw from "@/lib/changelog";
import { markReleaseSeen, parseChangelog, pendingRelease, type ReleaseInfo } from "@/lib/release";

/** 版本说明弹窗：读取构建期打包的 CHANGELOG，仅在首次看到最新版本时提示一次。 */
export default function ReleaseNotesDialog() {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);

  useEffect(() => {
    setRelease(pendingRelease(parseChangelog(changelogRaw)));
  }, []);

  const dismiss = () => {
    if (release) markReleaseSeen(release.version);
    setRelease(null);
  };

  if (!release) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismiss(); }}>
      <DialogContent className="release-notes-dialog">
        <DialogHeader>
          <DialogTitle>版本 {release.version} 已上线</DialogTitle>
          <DialogDescription>{release.date || "本次更新包含以下改动"}</DialogDescription>
        </DialogHeader>
        <div className="release-notes-list">
          {release.items.map((item, index) => (
            <div key={`${item.type}-${index}`}>
              <span className="status-chip blue">{item.type}</span>
              <p>{item.content}</p>
            </div>
          ))}
        </div>
        <button className="vermilion-button" onClick={dismiss}>知道了</button>
      </DialogContent>
    </Dialog>
  );
}
