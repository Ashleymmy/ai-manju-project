create table if not exists input_objects (
    storage_key text primary key,
    owner_subject text not null,
    workspace_id text not null,
    status text not null default 'pending' check(status in ('pending','complete','deleting','deleted')),
    content_type text not null,
    size_bytes bigint not null default 0,
    sha256 text,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);
create index if not exists idx_sdvideo_input_cleanup on input_objects(status,created_at);
