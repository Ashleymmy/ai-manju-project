import { ArrowDownWideNarrow, CalendarDays, Check, ChevronDown, ChevronUp, Download, Filter, FolderDown, ListChecks, Package, Upload, X } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type AssetToolbarOption = { value: string; label: string };

function OptionMenu({ value, options, onChange, align = "start" }: {
  value: string;
  options: AssetToolbarOption[];
  onChange: (value: string) => void;
  align?: "start" | "end";
}) {
  return (
    <DropdownMenuContent align={align} className="asset-menu asset-option-menu" data-keep-asset-selection="true">
      {options.map((option) => (
        <DropdownMenuItem key={option.value || "all"} data-active={option.value === value ? "true" : undefined} onSelect={() => onChange(option.value)}>
          <span>{option.label}</span>
          {option.value === value ? <Check size={14} className="asset-menu-check" aria-hidden="true" /> : null}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}

/** "Label + value" chip; an active filter shows a clear button instead of the caret. */
function FilterChip({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: AssetToolbarOption[];
  onChange: (value: string) => void;
}) {
  const current = value ? options.find((option) => option.value === value)?.label ?? value : "全部";
  return (
    <span className={value ? "asset-filter-chip on" : "asset-filter-chip"}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="asset-filter-chip-trigger" aria-label={`按${label}筛选：${current}`}>
            <span className="asset-filter-chip-key">{label}</span>
            <span>{current}</span>
            {value ? null : <ChevronDown size={12} aria-hidden="true" />}
          </button>
        </DropdownMenuTrigger>
        <OptionMenu value={value} options={options} onChange={onChange} />
      </DropdownMenu>
      {value ? <button type="button" aria-label={`清除${label}筛选`} title={`清除${label}筛选`} onClick={() => onChange("")}><X size={12} /></button> : null}
    </span>
  );
}

function shortDate(value: string) {
  const [, month, day] = value.split("-");
  return month && day ? `${month}/${day}` : value;
}

function dateRangeLabel(from: string, to: string) {
  if (from && to) return `${shortDate(from)} – ${shortDate(to)}`;
  if (from) return `${shortDate(from)} 起`;
  if (to) return `至 ${shortDate(to)}`;
  return "不限";
}

function DateRangeChip({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const active = Boolean(from || to);
  return (
    <span className={active ? "asset-filter-chip on" : "asset-filter-chip"}>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="asset-filter-chip-trigger" aria-label="按创建日期筛选">
            <CalendarDays size={12} aria-hidden="true" />
            <span className="asset-filter-chip-key">日期</span>
            <span>{dateRangeLabel(from, to)}</span>
            {active ? null : <ChevronDown size={12} aria-hidden="true" />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="asset-date-popover">
          <label>起<input type="date" value={from} max={to || undefined} onChange={(event) => onChange(event.target.value, to)} /></label>
          <label>止<input type="date" value={to} min={from || undefined} onChange={(event) => onChange(from, event.target.value)} /></label>
        </PopoverContent>
      </Popover>
      {active ? <button type="button" aria-label="清除日期筛选" title="清除日期筛选" onClick={() => onChange("", "")}><X size={12} /></button> : null}
    </span>
  );
}

export type AssetSortOrder = "created_at_desc" | "created_at_asc" | "name_asc" | "name_desc";

const SORT_OPTIONS: Array<{ value: AssetSortOrder; label: string }> = [
  { value: "created_at_desc", label: "最新优先" },
  { value: "created_at_asc", label: "最早优先" },
  { value: "name_asc", label: "名称 A-Z" },
  { value: "name_desc", label: "名称 Z-A" },
];

const TYPE_OPTIONS: AssetToolbarOption[] = [
  { value: "", label: "全部类型" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
];

export function AssetLibraryToolbar(props: {
  category: string;
  categoryOptions: AssetToolbarOption[];
  onCategoryChange: (value: string) => void;
  sourceType: string;
  sourceOptions: AssetToolbarOption[];
  onSourceTypeChange: (value: string) => void;
  assetType: string;
  onAssetTypeChange: (value: string) => void;
  createdFrom: string;
  createdTo: string;
  onDateRangeChange: (from: string, to: string) => void;
  sortOrder: AssetSortOrder;
  onSortOrderChange: (value: AssetSortOrder) => void;
  tasksOpen: boolean;
  importRunning: boolean;
  onToggleTasks: () => void;
  exportBusy: string;
  folderExportAvailable: boolean;
  onExport: (mode: "filter" | "folder") => void;
  uploading: boolean;
  packageImporting: boolean;
  onImportFiles: () => void;
  onImportPackage: () => void;
}) {
  const sortLabel = SORT_OPTIONS.find((option) => option.value === props.sortOrder)?.label ?? SORT_OPTIONS[0].label;
  const filtered = Boolean(props.category || props.sourceType || props.assetType || props.createdFrom || props.createdTo);
  const clearFilters = () => {
    props.onCategoryChange("");
    props.onSourceTypeChange("");
    props.onAssetTypeChange("");
    props.onDateRangeChange("", "");
  };
  return (
    <div className="asset-library-toolbar">
      <FilterChip label="分类" value={props.category} options={props.categoryOptions} onChange={props.onCategoryChange} />
      <FilterChip label="来源" value={props.sourceType} options={props.sourceOptions} onChange={props.onSourceTypeChange} />
      <FilterChip label="类型" value={props.assetType} options={TYPE_OPTIONS} onChange={props.onAssetTypeChange} />
      <DateRangeChip from={props.createdFrom} to={props.createdTo} onChange={props.onDateRangeChange} />
      {filtered ? <button type="button" className="asset-filter-clear" onClick={clearFilters}>清除筛选</button> : null}
      <span className="asset-toolbar-spacer" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="asset-sort-select" aria-label={`排序：${sortLabel}`}>
            <ArrowDownWideNarrow size={14} aria-hidden="true" />{sortLabel}<ChevronDown size={12} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <OptionMenu align="end" value={props.sortOrder} options={SORT_OPTIONS} onChange={(value) => props.onSortOrderChange(value as AssetSortOrder)} />
      </DropdownMenu>
      <span className="asset-toolbar-divider" aria-hidden="true" />
      <button type="button" className={props.tasksOpen ? "asset-toolbar-button on" : "asset-toolbar-button"} aria-pressed={props.tasksOpen}
        title={props.tasksOpen ? "收起导入 / 导出任务" : "查看导入 / 导出任务"} onClick={props.onToggleTasks}>
        <ListChecks size={14} />任务
        {props.importRunning ? <span className="asset-toolbar-badge" title="有导入任务进行中">1</span> : null}
        {props.tasksOpen ? <ChevronUp size={12} className="caret" /> : <ChevronDown size={12} className="caret" />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="asset-toolbar-button"><Download size={14} />导出<ChevronDown size={12} className="caret" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="asset-menu" data-keep-asset-selection="true">
          <DropdownMenuItem disabled={props.exportBusy === "filter"} onSelect={() => props.onExport("filter")}><Filter size={14} />导出当前筛选结果</DropdownMenuItem>
          <DropdownMenuItem disabled={!props.folderExportAvailable || props.exportBusy === "folder"} onSelect={() => props.onExport("folder")}>
            <FolderDown size={14} />导出当前目录{props.folderExportAvailable ? null : <small>未选目录</small>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="asset-toolbar-button primary"><Upload size={14} />{props.uploading || props.packageImporting ? "导入中…" : "导入"}<ChevronDown size={12} className="caret" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="asset-menu" data-keep-asset-selection="true">
          <DropdownMenuItem disabled={props.uploading} onSelect={props.onImportFiles}><Upload size={14} />导入资产文件</DropdownMenuItem>
          <DropdownMenuItem disabled={props.packageImporting} onSelect={props.onImportPackage}><Package size={14} />导入资产包</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
