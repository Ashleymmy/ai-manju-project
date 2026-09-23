import { useEffect, useRef, useState } from "react";
import { getPreferences, updatePreferences, type ProjectGroupPreference } from "@/features/settings";
import { publicApiError } from "@/shared/api/errors";
import type { WorkspaceScope } from "@/shared/config";
import { toast } from "sonner";

// Match the server preference limits; rejected writes must leave the saved organization intact.
export const PROJECT_GROUP_TITLE_LIMIT = 80;
export const PROJECT_GROUP_COUNT_LIMIT = 100;

export function moveProjectsToGroup(groups: ProjectGroupPreference[], ids: string[], targetId: string) {
  if (targetId && !groups.some(group => group.id === targetId)) throw new Error("目标分组已不存在，请刷新后重试");
  const selected = new Set(ids);
  return groups.map(group => ({ ...group, projectIds: group.id === targetId
    ? [...new Set([...group.projectIds, ...ids])]
    : group.projectIds.filter(id => !selected.has(id)) }));
}

export function useProjectGroups(scope: WorkspaceScope) {
  const [groups, setGroups] = useState<ProjectGroupPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const busy = useRef(false);
  const context = useRef(scope);
  context.current = scope;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setGroups([]);
    void getPreferences().then(preferences => {
      if (!cancelled) setGroups(preferences.canvas?.projectGroups?.[scope] || []);
    }).catch(reason => {
      if (!cancelled) setError(publicApiError(reason, "读取项目分组失败"));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, revision]);

  const mutate = async (change: (current: ProjectGroupPreference[]) => ProjectGroupPreference[], message: string) => {
    if (busy.current || loading || error) return false;
    busy.current = true;
    setSaving(true);
    try {
      // Read immediately before writing so edits do not overwrite a stale page's groups or the other scope.
      const preferences = await getPreferences();
      const stored = preferences.canvas?.projectGroups || {};
      const next = { ...stored, [scope]: change(stored[scope] || []) };
      const saved = await updatePreferences({ canvas: { projectGroups: next }, expectedProjectGroups: stored });
      const signature = (items?: ProjectGroupPreference[]) => JSON.stringify(items?.map(group => [group.id, group.title, group.projectIds]));
      if (signature(saved.canvas?.projectGroups?.[scope]) !== signature(next[scope])) throw new Error("分组未保存，请确认服务端已更新后重试");
      if (context.current === scope) setGroups(saved.canvas!.projectGroups![scope] || []);
      toast.success(message);
      return true;
    } catch (reason) {
      toast.error(publicApiError(reason, "保存项目分组失败"));
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return {
    groups, loading, saving, error, reload: () => setRevision(value => value + 1),
    create: async (title: string, ids: string[]) => {
      const id = crypto.randomUUID();
      const saved = await mutate(current => {
        if (current.length >= PROJECT_GROUP_COUNT_LIMIT) throw new Error(`最多创建 ${PROJECT_GROUP_COUNT_LIMIT} 个分组`);
        const next = [...current, { id, title, projectIds: [] }];
        return moveProjectsToGroup(next, ids, id);
      }, "分组已创建");
      return saved ? id : "";
    },
    move: (ids: string[], targetId: string) => mutate(current => moveProjectsToGroup(current, ids, targetId), targetId ? "已移入分组" : "已移出分组"),
    rename: (id: string, title: string) => mutate(current => {
      if (!current.some(group => group.id === id)) throw new Error("分组已不存在，请刷新后重试");
      return current.map(group => group.id === id ? { ...group, title } : group);
    }, "分组已重命名"),
    dissolve: (id: string) => mutate(current => current.filter(group => group.id !== id), "分组已解散，画布已保留"),
  };
}
