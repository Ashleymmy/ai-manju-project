import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { Fragment, useId, useMemo, useRef, useState } from "react";
import type { SemanticTag } from "@/entities/tag";
import { semanticTagPath } from "@/features/tags";
import { assetTagBranches, assetTagEntries, searchAssetTagEntries, type AssetTagBranch } from "../model/assetTagTree";
import "./AssetTagFilter.css";

export function AssetTagFilter({ tags, selectedIds, match, onToggle, onClear, onMatchChange }: {
  tags: SemanticTag[];
  selectedIds: string[];
  match: "and" | "or";
  onToggle: (id: string) => void;
  onClear: () => void;
  onMatchChange: (value: "and" | "or") => void;
}) {
  const subpanelId = useId();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [activeTagId, setActiveTagId] = useState("");
  const rootTriggers = useRef(new Map<string, HTMLButtonElement>());
  const branches = useMemo(() => assetTagBranches(tags), [tags]);
  const entries = useMemo(() => assetTagEntries(branches), [branches]);
  const entriesById = useMemo(() => new Map(entries.map(entry => [entry.branch.tag.id, entry])), [entries]);
  const results = useMemo(() => searchAssetTagEntries(entries, query), [entries, query]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const tagsById = useMemo(() => new Map(tags.map(tag => [tag.id, tag])), [tags]);
  const searching = Boolean(query.trim());
  const activeEntry = entriesById.get(activeTagId);
  const current = activeEntry?.branch.children.length ? activeEntry : undefined;
  const trail = current ? [...current.ancestors, current.branch] : [];
  const closeSubpanel = () => {
    setActiveTagId("");
    if (trail.length) rootTriggers.current.get(trail[0].tag.id)?.focus();
  };
  const renderOption = (branch: AssetTagBranch, label = branch.tag.name, all = false) => <button
    type="button" className="asset-taxonomy-option" title={branch.path}
    aria-label={`${all ? "筛选全部" : "筛选标签"} ${branch.path}`} disabled={!branch.tag.asset_enabled}
    aria-pressed={selected.has(branch.tag.id)} onClick={() => onToggle(branch.tag.id)}>
    <span className="asset-taxonomy-name">{label}</span>
    {branch.tag.asset_enabled && <span className="asset-taxonomy-count">{branch.tag.asset_count || 0}</span>}
  </button>;
  const renderChoice = (branch: AssetTagBranch, root = false, fullPath = false) => {
    const browsing = !searching && trail.some(item => item.tag.id === branch.tag.id);
    return <li key={branch.tag.id} data-tag-id={branch.tag.id}
      className={`asset-taxonomy-choice${branch.children.length ? " has-children" : ""}${browsing ? " is-browsing" : ""}`}>
      {renderOption(branch, fullPath ? branch.path : branch.tag.name)}
      {branch.children.length > 0 && <button type="button" className="asset-taxonomy-toggle"
        ref={root ? element => {
          if (element) rootTriggers.current.set(branch.tag.id, element);
          else rootTriggers.current.delete(branch.tag.id);
        } : undefined}
        aria-label={`${browsing ? "收起" : "展开"}标签 ${branch.path}`} aria-expanded={browsing}
        aria-controls={subpanelId} title={`${browsing ? "收起" : "查看"} ${branch.path} 的子标签`}
        onClick={() => {
          if (browsing) closeSubpanel();
          else { setActiveTagId(branch.tag.id); setQuery(""); }
        }}>
        {browsing ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>}
    </li>;
  };
  return <section className="asset-taxonomy" aria-label="分类标签">
    <div className="asset-taxonomy-head">
      <h2 className="asset-taxonomy-title">分类标签</h2>
      <div className="asset-taxonomy-search">
        <Search size={14} aria-hidden="true" />
        <input ref={searchRef} aria-label="搜索分类标签" placeholder="搜索标签" value={query}
          onChange={event => setQuery(event.target.value)} />
        <button type="button" className="asset-taxonomy-tool" title="清空标签搜索"
          aria-label="清空标签搜索" disabled={!query} aria-hidden={!query}
          onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={14} /></button>
      </div>
      <div className="asset-taxonomy-controls">
        <div className="asset-taxonomy-match" role="group" aria-label="标签匹配方式">
          <button type="button" aria-pressed={match === "and"} onClick={() => onMatchChange("and")}>交集</button>
          <button type="button" aria-pressed={match === "or"} onClick={() => onMatchChange("or")}>并集</button>
        </div>
        <button type="button" className="asset-taxonomy-clear" disabled={!selectedIds.length} onClick={onClear}>清空</button>
      </div>
    </div>
    <div className="asset-taxonomy-content">
      {searching ? (results.length ? <ul className="asset-taxonomy-search-results" aria-label="标签搜索结果">
        {results.map(({ branch }) => renderChoice(branch, false, true))}
      </ul> : <p className="asset-taxonomy-empty">没有匹配的标签</p>) : <>
        {branches.length ? <ul className="asset-taxonomy-ribbon" aria-label="一级标签">
          {branches.map(branch => renderChoice(branch, true))}
        </ul> : <p className="asset-taxonomy-empty">暂无分类标签</p>}
        {current && <section id={subpanelId} className="asset-taxonomy-subpanel" aria-label="子标签"
          onKeyDown={event => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeSubpanel(); }
          }}>
          <div className="asset-taxonomy-subhead">
            <nav className="asset-taxonomy-breadcrumb" aria-label="标签层级路径">
              {trail.map((branch, index) => <Fragment key={branch.tag.id}>
                {index > 0 && <ChevronRight size={13} aria-hidden="true" />}
                {index === trail.length - 1 ? <span aria-current="location" title={branch.path}>{branch.tag.name}</span>
                  : <button type="button" title={branch.path} aria-label={`返回标签 ${branch.path}`}
                    onClick={() => setActiveTagId(branch.tag.id)}>{branch.tag.name}</button>}
              </Fragment>)}
            </nav>
            <button type="button" className="asset-taxonomy-tool" title="收起子标签" aria-label="收起子标签" onClick={closeSubpanel}><X size={15} /></button>
          </div>
          <ul className="asset-taxonomy-options" aria-label={`${current.branch.path} 的子标签`}>
            <li className="asset-taxonomy-choice">{renderOption(current.branch, `全部${current.branch.tag.name}`, true)}</li>
            {current.branch.children.map(branch => renderChoice(branch))}
          </ul>
        </section>}
      </>}
    </div>
    {selectedIds.length > 0 && <div className="asset-taxonomy-selected" aria-label="已选分类标签">
      <span className="asset-taxonomy-selected-label">已选 {selectedIds.length}</span>
      {selectedIds.map(id => {
        const path = entriesById.get(id)?.branch.path || (tagsById.has(id) ? semanticTagPath(id, tags) : "标签暂不可用");
        return <span key={id} className="asset-taxonomy-selected-item" title={path}><span>{path}</span>
          <button type="button" title={`取消筛选 ${path}`} aria-label={`取消筛选 ${path}`} onClick={() => onToggle(id)}><X size={13} /></button>
        </span>;
      })}
    </div>}
  </section>;
}
