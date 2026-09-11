-- 只整理新服务自身的标签关系；不访问旧项目表。
update volcano_assets a set tags=coalesce((
    select jsonb_agg(t.id order by t.id) from global_tags t
    where t.workspace_id=a.workspace_id and a.tags ? t.id
), '[]'::jsonb);

insert into asset_tags(asset_id,tag_id)
select a.id,t.id from volcano_assets a join global_tags t
on t.workspace_id=a.workspace_id and a.tags ? t.id
on conflict do nothing;

create or replace function sdvideo_sync_asset_tags() returns trigger language plpgsql as $$
declare tag text;
begin
    delete from asset_tags where asset_id=new.id;
    for tag in select distinct jsonb_array_elements_text(new.tags) loop
        -- 与标签删除互斥；禁止跨空间标签和已经删除的标签写入。
        perform 1 from global_tags where id=tag and workspace_id=new.workspace_id for key share;
        if not found then
            raise foreign_key_violation using message='asset tag is not in workspace';
        end if;
        insert into asset_tags(asset_id,tag_id) values(new.id,tag);
    end loop;
    return new;
end $$;

create trigger sdvideo_asset_tags_sync after insert or update of tags on volcano_assets
for each row execute function sdvideo_sync_asset_tags();
