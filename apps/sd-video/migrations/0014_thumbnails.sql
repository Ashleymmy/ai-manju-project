-- 缩略图状态独立于付费生成结果，Worker 重启后按租约补偿。
alter table media_library add column if not exists thumbnail_error text;
alter table media_library add column if not exists thumbnail_lease_owner text;
alter table media_library add column if not exists thumbnail_lease_until timestamptz;
alter table media_library add column if not exists thumbnail_next_attempt timestamptz not null default now();
alter table volcano_assets add column if not exists thumbnail_key text;
alter table volcano_assets add column if not exists thumbnail_error text;
alter table volcano_assets add column if not exists thumbnail_lease_owner text;
alter table volcano_assets add column if not exists thumbnail_lease_until timestamptz;
alter table volcano_assets add column if not exists thumbnail_next_attempt timestamptz not null default now();
create index if not exists media_thumbnail_queue on media_library(thumbnail_next_attempt,id)
    where kind in ('image','video') and thumbnail_key is null;
create index if not exists volcano_thumbnail_queue on volcano_assets(thumbnail_next_attempt,id)
    where kind in ('image','video') and thumbnail_key is null and status not in ('deleted','delete_requested');
