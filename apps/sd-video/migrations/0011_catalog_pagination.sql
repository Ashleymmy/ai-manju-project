-- 稳定的分页排序包含主键；只增索引，不覆写旧迁移或业务记录。
create index if not exists idx_sdvideo_tasks_owner_page
    on tasks(workspace_id, owner_subject, created_at desc, id desc);
create index if not exists idx_sdvideo_conversations_owner_page
    on conversations(workspace_id, owner_subject, updated_at desc, id desc);
create index if not exists idx_sdvideo_messages_owner_page
    on chat_messages(conversation_id, owner_subject, workspace_id, created_at, id);
create index if not exists idx_sdvideo_media_owner_page
    on media_library(workspace_id, owner_subject, created_at desc, id desc);
create index if not exists idx_sdvideo_media_metadata_tags
    on media_library using gin ((metadata->'tags'));
