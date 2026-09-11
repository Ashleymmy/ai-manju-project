-- 列表分页与引用点查询独立；已删除记录不再回到管理/引用入口。
create index if not exists volcano_assets_catalog_page
    on volcano_assets(owner_subject, workspace_id, created_at desc, id desc)
    where status <> 'deleted';
create index if not exists volcano_assets_active_reference
    on volcano_assets(owner_subject, workspace_id, provider_asset_id, provider_namespace)
    where status = 'active';
create index if not exists volcano_assets_tags_gin on volcano_assets using gin(tags);
create index if not exists global_tags_catalog_page
    on global_tags(workspace_id, name COLLATE "C", id);
