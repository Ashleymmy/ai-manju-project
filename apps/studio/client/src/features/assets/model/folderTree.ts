/* 资产文件夹树工具：把扁平的 AssetFolder 列表整理成可渲染的树序（按 sort_order/name 排序），
   并提供子树收集（移动文件夹时排除自身与后代）。纯函数，供资产库页与测试复用。 */

export type FolderLike = {
  id: string;
  parent_id: string;
  name: string;
  sort_order: number;
  kind?: string;
};

export type FolderTreeRow<T extends FolderLike> = {
  folder: T;
  depth: number;
  /** 是否有子文件夹（渲染展开/收起 chevron 用）。 */
  hasChildren: boolean;
  /** 自根到直接父级的祖先 id 链（折叠过滤用，不含自身）。 */
  ancestorIds: string[];
  /** 与 ancestorIds 等长：该层祖先是否为同级最后一个（画缩进参考线用，true = 该层不画竖线）。 */
  ancestorLast: boolean[];
};

function isSystemFolder(folder: FolderLike) {
  return folder.kind === "system";
}

/** 同级内用户文件夹排在系统文件夹之前，二者的 sort_order 互不干扰。 */
function compareFolders(a: FolderLike, b: FolderLike) {
  return (Number(isSystemFolder(a)) - Number(isSystemFolder(b)))
    || (a.sort_order - b.sort_order)
    || a.name.localeCompare(b.name, "zh-CN");
}

/** 与 folder 同级、可由用户调整顺序的文件夹（不含系统文件夹），按展示顺序排列。 */
export function reorderableFolderSiblings<T extends FolderLike>(folders: T[], folder: T): T[] {
  if (isSystemFolder(folder)) return [];
  const parentId = folder.parent_id || "";
  return folders
    .filter((item) => !isSystemFolder(item) && (item.parent_id || "") === parentId)
    .sort(compareFolders);
}

/** 上移/下移：交换后把同级用户文件夹重排为 0..n-1，只返回 sort_order 有变化的项；无法移动时返回空数组。 */
export function planFolderShift<T extends FolderLike>(folders: T[], folderId: string, direction: -1 | 1): Array<{ folder: T; sortOrder: number }> {
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return [];
  const siblings = reorderableFolderSiblings(folders, folder);
  const index = siblings.findIndex((item) => item.id === folderId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return [];
  const reordered = siblings.slice();
  [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
  return reordered
    .map((item, sortOrder) => ({ folder: item, sortOrder }))
    .filter(({ folder: item, sortOrder }) => item.sort_order !== sortOrder);
}

/** 扁平列表 → 深度优先树序；父节点缺失的文件夹按根级处理（防脏数据断链）。 */
export function flattenFolderTree<T extends FolderLike>(folders: T[]): Array<FolderTreeRow<T>> {
  const byParent = new Map<string, T[]>();
  const ids = new Set(folders.map((folder) => folder.id));
  folders.forEach((folder) => {
    const parentId = folder.parent_id && ids.has(folder.parent_id) ? folder.parent_id : "";
    const bucket = byParent.get(parentId) || [];
    bucket.push(folder);
    byParent.set(parentId, bucket);
  });
  const rows: Array<FolderTreeRow<T>> = [];
  const visit = (parentId: string, depth: number, ancestorIds: string[], ancestorLast: boolean[]) => {
    const children = (byParent.get(parentId) || []).slice().sort(compareFolders);
    children.forEach((folder, index) => {
      const isLast = index === children.length - 1;
      rows.push({ folder, depth, hasChildren: byParent.has(folder.id), ancestorIds, ancestorLast });
      visit(folder.id, depth + 1, [...ancestorIds, folder.id], [...ancestorLast, isLast]);
    });
  };
  visit("", 0, [], []);
  return rows;
}

/** 收集 folderId 及其全部后代 id（含自身），用于移动时禁止选入自身子树。 */
export function collectFolderSubtreeIds<T extends FolderLike>(folders: T[], rootId: string): Set<string> {
  const result = new Set<string>();
  if (!rootId) return result;
  const byParent = new Map<string, T[]>();
  folders.forEach((folder) => {
    const bucket = byParent.get(folder.parent_id) || [];
    bucket.push(folder);
    byParent.set(folder.parent_id, bucket);
  });
  const walk = (id: string) => {
    if (result.has(id)) return;
    result.add(id);
    (byParent.get(id) || []).forEach((child) => walk(child.id));
  };
  walk(rootId);
  return result;
}

/** 文件夹路径文案（父/子/孙），父链断开的部分自动跳过。 */
export function folderPathLabel<T extends FolderLike>(folders: T[], id: string): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  let current = byId.get(id);
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    names.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return names.join(" / ");
}
