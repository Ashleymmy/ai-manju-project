/* 资产文件夹树工具：把扁平的 AssetFolder 列表整理成可渲染的树序（按 sort_order/name 排序），
   并提供子树收集（移动文件夹时排除自身与后代）。纯函数，供资产库页与测试复用。 */

export type FolderLike = {
  id: string;
  parent_id: string;
  name: string;
  sort_order: number;
};

export type FolderTreeRow<T extends FolderLike> = {
  folder: T;
  depth: number;
};

function compareFolders(a: FolderLike, b: FolderLike) {
  return (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, "zh-CN");
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
  const visit = (parentId: string, depth: number) => {
    const children = (byParent.get(parentId) || []).slice().sort(compareFolders);
    children.forEach((folder) => {
      rows.push({ folder, depth });
      visit(folder.id, depth + 1);
    });
  };
  visit("", 0);
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
