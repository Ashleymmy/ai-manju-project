"""新云栈数据库备份/空库恢复演练；不覆盖现有库，不自动删除备份。"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import uuid
import re

HERE = Path(__file__).resolve().parent
DATABASES = {"postgres": ("studio", "studio_cloud"), "sd-video-postgres": ("sdvideo", "sdvideo_cloud")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["backup", "restore-check"])
    parser.add_argument("--compose-env", type=Path)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--test-database", help="仅隔离 E2E 空库演练，限定 phase2_<uuid> 数据库")
    args = parser.parse_args()
    directory = args.directory.resolve()
    if directory == Path(directory.anchor): parser.error("a dedicated backup directory is required")
    if args.test_database:
        if not re.fullmatch(r"phase2_[a-f0-9]{32}", args.test_database): parser.error("only an isolated E2E database is allowed")
        compose = ["docker", "compose", "-f", str(HERE / "compose.mock-deps.yml")]
        databases = {"studio-db": ("studio_test", args.test_database), "sdvideo-db": ("sdvideo_test", args.test_database)}
    else:
        if not args.compose_env: parser.error("--compose-env is required for the cloud stack")
        environment = args.compose_env.resolve(strict=True)
        compose = ["docker", "compose", "--env-file", str(environment), "-f", str(HERE / "compose.yml")]
        databases = DATABASES
    if args.action == "backup":
        folder = directory / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8])
        folder.mkdir(parents=True, exist_ok=False, mode=0o700)
        manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "files": {}}
        for service, (owner, database) in databases.items():
            target = folder / (service + ".dump")
            temporary = target.with_suffix(".partial")
            with temporary.open("xb") as output:
                subprocess.run([*compose, "exec", "-T", service, "pg_dump", "-U", owner, "-d", database, "-Fc", "--no-owner", "--no-acl"], stdout=output, check=True, timeout=840)
            temporary.replace(target)
            with target.open("rb") as source: digest = hashlib.file_digest(source, "sha256").hexdigest()
            manifest["files"][target.name] = {"sha256": digest, "size": target.stat().st_size}
        (folder / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(f"Backup completed: {folder}. Off-host copy and OSS retention must be configured separately.")
    else:
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        for service, (owner, database) in databases.items():
            archive = directory / (service + ".dump")
            with archive.open("rb") as source: digest = hashlib.file_digest(source, "sha256").hexdigest()
            if digest != manifest["files"][archive.name]["sha256"]: raise ValueError("backup checksum mismatch")
            destination = "restore_check_" + uuid.uuid4().hex
            subprocess.run([*compose, "exec", "-T", service, "createdb", "-U", owner, destination], check=True, timeout=30)
            with archive.open("rb") as source:
                subprocess.run([*compose, "exec", "-T", service, "pg_restore", "-U", owner, "-d", destination, "--exit-on-error", "--no-owner", "--no-acl"], stdin=source, check=True, timeout=840)
            subprocess.run([*compose, "exec", "-T", service, "psql", "-U", owner, "-d", destination, "-v", "ON_ERROR_STOP=1", "-c", "SELECT count(*) AS restored_tables FROM information_schema.tables WHERE table_schema='public'"], check=True, timeout=30)
            print(f"Restored into NEW database {service}/{destination}; original database unchanged. Rehearsal database retained for inspection.")


if __name__ == "__main__": main()
