-- Catalog fields added after the initial durable rollout. Kept separate so
-- already provisioned environments receive the change without re-running a
-- historical migration.
alter table chat_messages add column if not exists role text not null default 'user';
alter table chat_messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table volcano_assets add column if not exists tags jsonb not null default '[]'::jsonb;
