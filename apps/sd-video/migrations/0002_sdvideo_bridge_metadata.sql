-- Studio bridge metadata is kept in the standalone service for reconciliation
-- and is intentionally opaque to the legacy SD-video deployment.
alter table tasks add column if not exists studio_job_id text;
alter table tasks add column if not exists studio_project_id text;
alter table tasks add column if not exists studio_node_id text;
create index if not exists idx_sdvideo_tasks_studio_job on tasks (studio_job_id);
