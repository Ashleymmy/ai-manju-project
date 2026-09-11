-- Execution metadata used by the durable worker.  This migration is safe on
-- databases created by 0001 and on databases upgraded from an early preview.
alter table tasks add column if not exists lease_owner text;
alter table tasks add column if not exists lease_expires_at timestamptz;
alter table tasks add column if not exists last_error_code text;
alter table tasks add column if not exists result_storage_key text;
alter table chat_messages add column if not exists role text not null default 'user';
alter table chat_messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table volcano_assets add column if not exists tags jsonb not null default '[]'::jsonb;
create index if not exists idx_sdvideo_tasks_worker_queue on tasks (status, updated_at);
create index if not exists idx_sdvideo_tasks_lease on tasks (lease_expires_at);
