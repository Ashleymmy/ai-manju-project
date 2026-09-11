"""在全新本机 PostgreSQL 测试库验证 RLS 模板；不是生产 Storage API 验收。"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

import psycopg
from psycopg import sql


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", required=True)
    args = parser.parse_args()
    target = urlsplit(args.dsn)
    if target.hostname != "127.0.0.1" or target.path != "/storage_isolation_test":
        raise ValueError("Only an explicit loopback storage_isolation_test database is accepted")
    with psycopg.connect(args.dsn, autocommit=True) as connection:
        if connection.execute("select count(*) from pg_namespace where nspname='storage'").fetchone()[0]:
            raise ValueError("Refusing an existing storage schema; use a fresh disposable test database")
        # 最小 Storage 表结构 + 故意宽松的旧 PUBLIC policy，证明 restrictive fence 真正生效。
        connection.execute("""
          CREATE ROLE supabase_storage_admin NOLOGIN;
          CREATE ROLE anon NOLOGIN;
          CREATE ROLE authenticated NOLOGIN;
          CREATE SCHEMA storage;
          CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean NOT NULL);
          CREATE TABLE storage.objects (id text PRIMARY KEY, bucket_id text REFERENCES storage.buckets, name text);
          ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
          ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
          GRANT USAGE ON SCHEMA storage TO anon, authenticated;
          GRANT ALL ON storage.buckets, storage.objects TO anon, authenticated;
          CREATE POLICY legacy_open ON storage.buckets TO PUBLIC USING (true) WITH CHECK (true);
          CREATE POLICY legacy_open ON storage.objects TO PUBLIC USING (true) WITH CHECK (true);
          INSERT INTO storage.buckets VALUES ('private','private',false);
          INSERT INTO storage.objects VALUES ('old','private','old-video');
        """)
        connection.execute(Path(__file__).with_name("storage-isolation.sql").read_text(encoding="utf-8"))
        buckets = [row[0] for row in connection.execute("select id from storage.buckets where id <> 'private'")]
        for bucket in buckets:
            connection.execute("insert into storage.objects values (%s,%s,'existing')", (bucket, bucket))

        def scoped(role, claims, action):
            with connection.transaction():
                connection.execute(sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(role)))
                connection.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
                return action()

        for role in ("studio_storage_service", "sdvideo_storage_service"):
            allowed = [b for b in buckets if b.startswith("studio-sdvideo-") == (role == "sdvideo_storage_service")]
            other = next(b for b in buckets if b not in allowed)
            # 即使签发 claim 错误地加入旧桶/其它服务桶，服务端固定映射仍拒绝。
            claims = {"sub": "service", "storage_buckets": buckets + ["private"]}
            visible = scoped(role, claims, lambda: connection.execute("select id from storage.buckets order by id").fetchall())
            assert [r[0] for r in visible] == sorted(allowed), (role, visible)
            visible = scoped(role, claims, lambda: connection.execute("select id from storage.objects order by id").fetchall())
            assert [r[0] for r in visible] == sorted(allowed), (role, visible)
            scoped(role, claims, lambda: connection.execute("insert into storage.objects values (%s,%s,'new')", (role, allowed[0])))
            scoped(role, claims, lambda: connection.execute("update storage.objects set name='updated' where id=%s", (role,)))
            assert scoped(role, claims, lambda: connection.execute("delete from storage.objects where id=%s", (role,)).rowcount) == 1
            for forbidden in ("private", other):
                try:
                    scoped(role, claims, lambda: connection.execute("insert into storage.objects values ('bad',%s,'x')", (forbidden,)))
                except psycopg.errors.InsufficientPrivilege:
                    pass
                else:
                    raise AssertionError("Cross-bucket write allowed")
                assert scoped(role, claims, lambda: connection.execute("delete from storage.objects where bucket_id=%s", (forbidden,)).rowcount) == 0
            assert scoped(role, {"storage_buckets": allowed}, lambda: connection.execute("select * from storage.objects").fetchall()) == []
            assert scoped(role, {"sub": "service", "storage_buckets": []}, lambda: connection.execute("select * from storage.objects").fetchall()) == []
            # 不能创建桶，不能把自己的对象转移到其它桶。
            for statement, values in (("insert into storage.buckets values ('new-bucket','new-bucket',true)", ()),
                                      ("update storage.objects set bucket_id=%s where id=%s", (other, allowed[0]))):
                try:
                    scoped(role, claims, lambda: connection.execute(statement, values))
                except psycopg.errors.InsufficientPrivilege:
                    pass
                else:
                    raise AssertionError("Bucket administration or move allowed")
        for role in ("anon", "authenticated"):
            assert scoped(role, {}, lambda: connection.execute("select id from storage.objects").fetchall()) == [("old",)]
            assert scoped(role, {}, lambda: connection.execute("select id from storage.buckets").fetchall()) == [("private",)]
        assert connection.execute("select name from storage.objects where id='old'").fetchone() == ("old-video",)
    print("PASS: PostgreSQL RLS own-bucket CRUD, cross-role/old-bucket denial, old PUBLIC policy fencing, missing claims, anon isolation, old fixture unchanged")


if __name__ == "__main__":
    main()
