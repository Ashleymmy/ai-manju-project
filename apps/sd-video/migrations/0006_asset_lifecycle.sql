-- 素材状态只由服务端推进；不接受客户端声明 Active。
alter table volcano_assets alter column provider_asset_id drop not null;
alter table volcano_assets alter column status set default 'queued';
alter table volcano_assets add column if not exists upstream_provider text not null default 'legacy_proxy';
alter table volcano_assets add column if not exists group_id text;
alter table volcano_assets add column if not exists storage_key text;
alter table volcano_assets add column if not exists kind text not null default 'image';
alter table volcano_assets add column if not exists lease_owner text;
alter table volcano_assets add column if not exists lease_until timestamptz;
alter table volcano_assets add column if not exists next_poll_at timestamptz not null default now();
alter table volcano_assets add column if not exists submission_started_at timestamptz;
alter table volcano_assets add column if not exists error jsonb;
create index if not exists idx_sdvideo_asset_poll on volcano_assets(next_poll_at)
    where status in ('queued','processing','delete_requested');
