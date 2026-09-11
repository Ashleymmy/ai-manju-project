-- 核对记录不可覆盖；原失败原因与操作者保留，修改与任务状态在同一事务提交。
create table if not exists task_reconciliations (
    task_id text primary key references tasks(id),
    actor_subject text not null,
    expected_attempt integer not null check(expected_attempt > 0),
    decision text not null check(decision in ('bind_existing','confirm_not_submitted')),
    evidence_ref text not null,
    provider_task_id text,
    provider_status text,
    previous_error jsonb not null,
    request_id text not null,
    reviewed_at timestamptz not null default now(),
    check ((decision='bind_existing') = (provider_task_id is not null))
);
