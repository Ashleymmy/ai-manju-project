-- 幂等键必须同时隔离用户和工作空间；不同 attempt 不覆盖原任务。
alter table tasks drop constraint if exists tasks_workspace_id_idempotency_key_key;
create unique index if not exists idx_sdvideo_task_owner_idempotency on tasks(workspace_id,owner_subject,idempotency_key);
alter table tasks add column if not exists retry_of text references tasks(id);
alter table tasks add column if not exists submission_started_at timestamptz;
alter table tasks add column if not exists inputs_cleaned_at timestamptz;
alter table model_configs add column if not exists version bigint not null default 1;
alter table conversations add column if not exists version bigint not null default 1;
alter table chat_messages add column if not exists version bigint not null default 1;
alter table chat_messages add column if not exists metadata jsonb not null default '{}'::jsonb;
create index if not exists idx_sdvideo_task_recovery on tasks(status,lease_expires_at,updated_at);
