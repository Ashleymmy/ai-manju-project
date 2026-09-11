"""Apply standalone SD-video SQL migrations to the new database only."""

import os
from pathlib import Path

import psycopg


def database_url() -> str:
    filename = os.getenv("SDVIDEO_DATABASE_URL_FILE", "")
    value = Path(filename).read_text(encoding="utf-8").strip() if filename else os.getenv("SDVIDEO_DATABASE_URL")
    if value:
        return value
    host = os.getenv("SDVIDEO_DB_HOST", "127.0.0.1")
    port = os.getenv("SDVIDEO_DB_PORT", "55433")
    user = os.getenv("SDVIDEO_DB_USER", "sdvideo")
    password = os.getenv("SDVIDEO_DB_PASSWORD", "")
    name = os.getenv("SDVIDEO_DB_NAME", "sdvideo_cloud")
    return f"host={host} port={port} user={user} password={password} dbname={name}"


def main() -> None:
    migration_dir = Path(__file__).resolve().parents[1] / "migrations"
    files = sorted(migration_dir.glob("*.sql"))
    with psycopg.connect(database_url()) as connection:
        connection.execute("select pg_advisory_xact_lock(hashtextextended('sdvideo:migrations',0))")
        connection.execute("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())")
        applied = {row[0] for row in connection.execute("select version from schema_migrations")}
        for path in files:
            if path.name in applied:
                continue
            connection.execute(path.read_text(encoding="utf-8"))
            connection.execute("insert into schema_migrations(version) values (%s)", (path.name,))
        connection.commit()
    print(f"applied {len(files) - len(applied)} migration(s)")


if __name__ == "__main__":
    main()
