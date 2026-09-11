-- New standalone SD-video database.  This migration deliberately has no
-- foreign keys to Studio or Supabase Auth and must run against a fresh DB.
create extension if not exists pgcrypto;

create table if not exists model_configs (
    id text primary key,
    model_id text not null,
    provider text not null,
    name text not null,
    enabled boolean not null default true,
    capabilities jsonb not null default '{}'::jsonb,
    config jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists tasks (
    id text primary key,
    owner_subject text not null,
    workspace_id text not null,
    idempotency_key text not null,
    model text not null,
    provider text not null,
    prompt text,
    status text not null check (status in ('queued','running','succeeded','failed','cancel_requested','canceled')),
    progress integer not null default 0 check (progress between 0 and 100),
    attempt integer not null default 1,
    request jsonb not null default '{}'::jsonb,
    result jsonb,
    error jsonb,
    provider_task_id text,
    cancel_requested_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, idempotency_key)
);
create index if not exists idx_sdvideo_tasks_owner_status on tasks (workspace_id, owner_subject, status);
create index if not exists idx_sdvideo_tasks_provider_task on tasks (provider, provider_task_id);

create table if not exists task_events (
    id bigint generated always as identity primary key,
    task_id text not null references tasks(id) on delete cascade,
    status text not null,
    progress integer not null default 0,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists idx_sdvideo_task_events_task_time on task_events (task_id, created_at);

create table if not exists conversations (
    id text primary key,
    owner_subject text not null,
    workspace_id text not null,
    title text not null,
    thumbnail_ref text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_sdvideo_conversations_owner on conversations (workspace_id, owner_subject, updated_at desc);

create table if not exists chat_messages (
    id text primary key,
    conversation_id text not null references conversations(id) on delete cascade,
    owner_subject text not null,
    workspace_id text not null,
    text text not null,
    task_id text references tasks(id) on delete set null,
    video_url text,
    created_at timestamptz not null default now()
);
create index if not exists idx_sdvideo_messages_conversation on chat_messages (conversation_id, created_at);

create table if not exists media_library (
    id text primary key,
    owner_subject text not null,
    workspace_id text not null,
    name text not null,
    kind text not null check (kind in ('image','video','audio')),
    storage_key text not null,
    thumbnail_key text,
    content_type text,
    size_bytes bigint not null default 0,
    metadata jsonb not null default '{}'::jsonb,
    task_id text references tasks(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_sdvideo_media_owner_kind on media_library (workspace_id, owner_subject, kind, created_at desc);

create table if not exists global_tags (
    id text primary key,
    workspace_id text not null,
    name text not null,
    created_at timestamptz not null default now(),
    unique (workspace_id, name)
);

create table if not exists volcano_assets (
    id text primary key,
    owner_subject text not null,
    workspace_id text not null,
    provider_namespace text not null,
    provider_asset_id text not null,
    name text,
    status text not null default 'active',
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, provider_namespace, provider_asset_id)
);

create table if not exists asset_tags (
    asset_id text not null references volcano_assets(id) on delete cascade,
    tag_id text not null references global_tags(id) on delete cascade,
    primary key (asset_id, tag_id)
);
