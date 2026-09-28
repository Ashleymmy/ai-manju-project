import type { SemanticTag } from "@/entities/tag";
import { flattenTagTree } from "@/features/tags";

export type AssetTagBranch = { tag: SemanticTag; path: string; children: AssetTagBranch[] };
export type AssetTagEntry = { branch: AssetTagBranch; ancestors: AssetTagBranch[] };

/** Preserve non-asset ancestors for context, without making them selectable. */
export function assetTagBranches(tags: SemanticTag[]): AssetTagBranch[] {
  const roots: AssetTagBranch[] = [];
  const ancestors: AssetTagBranch[] = [];
  for (const { tag, depth } of flattenTagTree(tags)) {
    ancestors.length = depth;
    const parent = ancestors[depth - 1];
    const branch = { tag, path: parent ? `${parent.path} / ${tag.name}` : tag.name, children: [] };
    (parent ? parent.children : roots).push(branch);
    ancestors.push(branch);
  }
  const keep = (branches: AssetTagBranch[]): AssetTagBranch[] => branches.flatMap(branch => {
    const children = keep(branch.children);
    return branch.tag.asset_enabled || children.length ? [{ ...branch, children }] : [];
  });
  return keep(roots);
}

export function assetTagEntries(branches: AssetTagBranch[], ancestors: AssetTagBranch[] = []): AssetTagEntry[] {
  return branches.flatMap(branch => [
    { branch, ancestors },
    ...assetTagEntries(branch.children, [...ancestors, branch]),
  ]);
}

export function searchAssetTagEntries(entries: AssetTagEntry[], query: string): AssetTagEntry[] {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return entries;
  return entries.filter(({ branch, ancestors }) => branch.path.toLocaleLowerCase().includes(keyword)
    || [...ancestors, branch].some(item => item.tag.aliases?.some(alias => alias.alias.toLocaleLowerCase().includes(keyword))));
}
