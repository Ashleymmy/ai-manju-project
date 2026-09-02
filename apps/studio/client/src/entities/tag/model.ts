export type TagInheritMode = "auto" | "manual" | "never";

export type SemanticTag = {
  id: string;
  scope_type: "system" | "public" | "workspace" | "user";
  parent_id: string;
  name: string;
  description: string;
  asset_enabled: boolean;
  prompt_enabled: boolean;
  inherit_mode: TagInheritMode;
  status: "active" | "archived";
  sort_order: number;
  aliases: Array<{ id: string; tag_id: string; alias: string }>;
  asset_count: number;
  prompt_count: number;
  editable: boolean;
  children_count: number;
};

export type TagListResult = {
  items: SemanticTag[];
  total: number;
  page: number;
  page_size: number;
};

export type AssetTagBindingState = "active" | "suppressed" | string;

export type AssetTagOriginType =
  "direct" | "inherited" | "ai_suggested" | "system" | "migrated" | string;

export type AssetTagBinding = {
  id: string;
  asset_id: string;
  tag_id: string;
  state: AssetTagBindingState;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
};

export type AssetTagOrigin = {
  id: string;
  binding_id: string;
  origin_type: AssetTagOriginType;
  source_asset_id?: string;
  source_job_id?: string;
  source_node_id?: string;
};

/** 资产维度标签详情：绑定 + 标签 + 来源（直接/继承/AI 建议等）。 */
export type AssetTagDetail = {
  binding: AssetTagBinding;
  tag: SemanticTag;
  origins: AssetTagOrigin[];
};
