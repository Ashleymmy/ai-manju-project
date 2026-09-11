-- 仅供存储运维审核后在独立测试 Storage 数据库执行；本项目不会自动运行。
-- 固定测试桶名，生产请整体更换命名；遇到同名角色/桶直接回滚，禁止认领旧桶。
-- 前提：Storage API v1.48.26，DB 连接角色为 supabase_storage_admin。
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'storage' AND c.relname = 'objects' AND c.relrowsecurity)
     OR NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'storage' AND c.relname = 'buckets' AND c.relrowsecurity) THEN
    RAISE EXCEPTION 'Existing Storage tables must already enforce RLS';
  END IF;
END $$;

CREATE ROLE studio_storage_service NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE sdvideo_storage_service NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
-- 只让 Storage 数据库连接身份切换角色，不授予 PostgREST authenticator。
GRANT studio_storage_service, sdvideo_storage_service TO supabase_storage_admin;
GRANT USAGE ON SCHEMA storage TO studio_storage_service, sdvideo_storage_service;
GRANT SELECT ON storage.buckets TO studio_storage_service, sdvideo_storage_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO studio_storage_service, sdvideo_storage_service;

INSERT INTO storage.buckets (id, name, public) VALUES
  ('studio-test-assets', 'studio-test-assets', false),
  ('studio-sdvideo-test-inputs', 'studio-sdvideo-test-inputs', false),
  ('studio-sdvideo-test-results', 'studio-sdvideo-test-results', false),
  ('studio-sdvideo-test-thumbnails', 'studio-sdvideo-test-thumbnails', false),
  ('studio-sdvideo-test-volcano', 'studio-sdvideo-test-volcano', false);

-- helper 只在 storage schema；固定搜索路径、SECURITY INVOKER，不绕过 RLS。
-- 固定角色到桶映射与签名 claim 求交集，不能仅相信请求携带的桶列表。
CREATE FUNCTION storage.studio_bucket_allowed(target_bucket text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
  SELECT coalesce(
    (CASE current_user
      WHEN 'studio_storage_service' THEN target_bucket = 'studio-test-assets'
      WHEN 'sdvideo_storage_service' THEN target_bucket IN (
        'studio-sdvideo-test-inputs', 'studio-sdvideo-test-results',
        'studio-sdvideo-test-thumbnails', 'studio-sdvideo-test-volcano')
      ELSE false END)
    AND (nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'storage_buckets') ? target_bucket
    AND coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '') <> '', false)
$$;
REVOKE ALL ON FUNCTION storage.studio_bucket_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storage.studio_bucket_allowed(text) TO studio_storage_service, sdvideo_storage_service;

-- RESTRICTIVE 约束旧 PUBLIC permissive policy：专用角色绝不能借旧开放策略越界。
CREATE POLICY studio_private_bucket_bound ON storage.buckets AS RESTRICTIVE
  TO studio_storage_service, sdvideo_storage_service USING (storage.studio_bucket_allowed(id) AND public = false);
CREATE POLICY studio_private_bucket_read ON storage.buckets FOR SELECT
  TO studio_storage_service, sdvideo_storage_service USING (storage.studio_bucket_allowed(id) AND public = false);
CREATE POLICY studio_object_bound ON storage.objects AS RESTRICTIVE
  TO studio_storage_service, sdvideo_storage_service
  USING (storage.studio_bucket_allowed(bucket_id)) WITH CHECK (storage.studio_bucket_allowed(bucket_id));
CREATE POLICY studio_object_access ON storage.objects
  TO studio_storage_service, sdvideo_storage_service
  USING (storage.studio_bucket_allowed(bucket_id)) WITH CHECK (storage.studio_bucket_allowed(bucket_id));

-- 旧 authenticated/anon PUBLIC 策略也不能读取这 5 个新桶。仅收紧新桶，不改变旧数据权限。
CREATE POLICY studio_new_bucket_protect ON storage.buckets AS RESTRICTIVE TO PUBLIC
  USING (id NOT IN ('studio-test-assets', 'studio-sdvideo-test-inputs', 'studio-sdvideo-test-results',
                    'studio-sdvideo-test-thumbnails', 'studio-sdvideo-test-volcano')
         OR (storage.studio_bucket_allowed(id) AND public = false));
CREATE POLICY studio_new_object_protect ON storage.objects AS RESTRICTIVE TO PUBLIC
  USING (bucket_id NOT IN ('studio-test-assets', 'studio-sdvideo-test-inputs', 'studio-sdvideo-test-results',
                           'studio-sdvideo-test-thumbnails', 'studio-sdvideo-test-volcano')
         OR storage.studio_bucket_allowed(bucket_id))
  WITH CHECK (bucket_id NOT IN ('studio-test-assets', 'studio-sdvideo-test-inputs', 'studio-sdvideo-test-results',
                                'studio-sdvideo-test-thumbnails', 'studio-sdvideo-test-volcano')
              OR storage.studio_bucket_allowed(bucket_id));
-- PUBLIC policy 会解析 helper；函数只计算布尔值，不查询任何表或返回凭证。
GRANT EXECUTE ON FUNCTION storage.studio_bucket_allowed(text) TO PUBLIC;
COMMIT;
