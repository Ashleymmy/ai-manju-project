-- 现有 Studio 素材表单的元数据，不迁移旧资产。
alter table global_tags add column if not exists color text;
alter table volcano_assets add column if not exists description text not null default '';
