alter table tasks add column if not exists next_poll_at timestamptz not null default now();
create table if not exists usage_logs (
    task_id text primary key references tasks(id),
    owner_subject text not null,
    workspace_id text not null,
    model text not null,
    provider text not null,
    amount numeric,
    currency text,
    created_at timestamptz not null default now()
);
-- 单一生命周期来源，避免工具任务和统计表各自维护状态。
create or replace view amk_tasks as select * from tasks where provider='mediakit';
create or replace view user_statistics as
    select workspace_id,owner_subject,count(*) completed_tasks,count(amount) priced_tasks,
           sum(amount) known_amount from usage_logs group by workspace_id,owner_subject;
