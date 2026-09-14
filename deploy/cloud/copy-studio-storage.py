"""在停止写入后，分批复制当前 Studio 本地资产；不删除、不切换存储。

在现有图片 Worker 镜像内运行，源卷必须只读挂载到 /app/data/assets，
独立进度目录挂载到 /migration-state。仅允许已批准的新 Studio 测试桶。
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import signal
import stat
import tempfile
import time

SOURCE = Path("/app/data/assets")
STATE = Path("/migration-state")
ORIGIN = "https://sd.ggwp.cn:18000"
BUCKET = "studio-test-assets"
ROOTS = {"personal", "team", "jobs", "exports"}
BATCH_BYTES = 32 * 1024 * 1024
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_SECONDS = 600
EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm",
              ".mov", ".mp3", ".wav", ".m4a", ".ogg", ".bin")
MIME_EXTENSIONS = {
    "image/png": [".png"], "image/jpeg": [".jpeg", ".jpg"],
    "image/webp": [".webp"], "image/gif": [".gif"],
    "video/mp4": [".mp4"], "video/webm": [".webm"], "video/quicktime": [".mov"],
    "audio/mpeg": [".mp3"], "audio/wav": [".wav"], "audio/mp4": [".m4a"],
    "audio/ogg": [".ogg"],
}


class CopyError(RuntimeError):
    pass


class CopyTimeout(CopyError):
    pass


def canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def fingerprint(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE_BYTES:
        raise CopyError("Source is not a regular file or exceeds the 64 MiB file limit")
    with path.open("rb") as stream:
        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
    after = path.lstat()
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)
    if identity(info) != identity(after):
        raise CopyError("Source changed while hashing; keep application writers stopped")
    return {"size": info.st_size, "mtime_ns": info.st_mtime_ns, "sha256": checksum}


def validate_key(key):
    parts = key.split("/")
    if (len(parts) < 2 or parts[0] not in ROOTS or any(p in {"", ".", ".."} for p in parts)
            or "\\" in key or any(ord(c) < 32 for c in key)):
        raise CopyError("Source contains a key outside the approved four directories")


def snapshot(root):
    if root.is_symlink() or not root.is_dir():
        raise CopyError("Source root is missing or is a symbolic link")
    found = {}

    def fail(error):
        raise error

    for directory, dirs, files in os.walk(root, followlinks=False, onerror=fail):
        for name in dirs:
            if (Path(directory) / name).is_symlink():
                raise CopyError("Source contains a symbolic-link directory")
        for name in files:
            path = Path(directory) / name
            key = path.relative_to(root).as_posix()
            validate_key(key)
            found[key] = fingerprint(path)
    if not found:
        raise CopyError("Source is empty; refusing to create an empty migration")
    return dict(sorted(found.items()))


def database_snapshot():
    import psycopg
    from psycopg.rows import dict_row
    from worker.config import load_settings

    with psycopg.connect(load_settings().database_url, connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = True
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        conn.execute("SET LOCAL statement_timeout = '10s'")
        jobs = conn.execute("SELECT status, count(*) AS count FROM jobs GROUP BY status ORDER BY status").fetchall()
        exports = conn.execute("SELECT id, status, storage_key, size FROM asset_export_batches ORDER BY id").fetchall()
        if any(row["status"] not in {"succeeded", "failed", "canceled"} for row in jobs):
            raise CopyError("Nonterminal generation jobs exist; do not cancel them for this copy")
        if any(row["status"] in {"queued", "running"} for row in exports):
            raise CopyError("Nonterminal export jobs exist; wait before copying")
        assets = conn.execute("SELECT id, user_id, workspace_id, url, content_type, size, content_sha256 FROM assets ORDER BY id").fetchall()
        seeds = conn.execute("SELECT id, storage_key, size FROM seedance_assets WHERE storage_key <> '' ORDER BY id").fetchall()
    return {"assets": assets, "exports": exports, "jobs": jobs, "seedance_assets": seeds}


def check_references(database, files):
    content_types = {}
    for asset in database["assets"]:
        user = asset["user_id"]
        workspace = asset["workspace_id"] or "default:" + user
        base = "team/default" if workspace == "team:default" else "personal/" + workspace.removeprefix("default:")
        extensions = [os.path.splitext(asset["url"] or "")[1]]
        extensions += MIME_EXTENSIONS.get((asset["content_type"] or "").strip().lower(), [])
        extensions += EXTENSIONS
        keys = [base + "/" + asset["id"] + ext for ext in extensions if ext]
        if not asset["workspace_id"]:
            keys += [user + "/" + asset["id"] + ext for ext in extensions if ext]
        key = next((key for key in keys if key in files), None)
        if key is None:
            raise CopyError("Registered asset has no readable local source: " + asset["id"])
        file = files[key]
        if file["size"] != asset["size"]:
            raise CopyError("Registered asset size mismatch: " + asset["id"])
        expected = (asset["content_sha256"] or "").strip().lower()
        if expected and expected != file["sha256"]:
            raise CopyError("Registered asset SHA-256 mismatch: " + asset["id"])
        content_types[key] = asset["content_type"] or "application/octet-stream"
    for row in database["exports"] + database["seedance_assets"]:
        if row.get("status") not in {None, "succeeded", "partial_failed"} or not row["storage_key"]:
            continue
        key = row["storage_key"]
        if key not in files or files[key]["size"] != row["size"]:
            raise CopyError("Associated file is missing or differs from its registered size: " + row["id"])
    return content_types


def read_json(path):
    if path.is_symlink() or not path.is_file():
        raise CopyError("Required migration state is missing or is a symbolic link")
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value, *, create=False):
    if path.is_symlink() or (create and path.exists()):
        raise CopyError("Refusing to replace an existing manifest or follow a state symlink")
    # 同一目录原子替换进度；中断不会把半份 JSON 当成已校验状态。
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".copy-state-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(canonical(value) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        if create:
            os.link(temporary, path)
        else:
            os.replace(temporary, path)
        if os.name != "nt":
            fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def plan(root, state, database):
    if (state / "manifest.json").exists() or (state / "progress.json").exists():
        raise CopyError("Migration state already exists; do not repeat plan")
    files = snapshot(root)
    types = check_references(database, files)
    manifest = {"version": 1, "origin": ORIGIN, "bucket": BUCKET, "files": files,
                "database_sha256": digest(database), "content_types": types,
                "reference_counts": {name: len(database[name]) for name in ("assets", "exports", "seedance_assets")}}
    write_json(state / "manifest.json", manifest, create=True)
    return manifest


def load_manifest(state):
    manifest = read_json(state / "manifest.json")
    if manifest.get("version") != 1 or manifest.get("origin") != ORIGIN or manifest.get("bucket") != BUCKET:
        raise CopyError("Manifest version or destination does not match this approved copy")
    for key in manifest["files"]:
        validate_key(key)
    return manifest


def load_progress(state, manifest):
    path = state / "progress.json"
    if path.is_symlink():
        raise CopyError("Progress must not be a symbolic link")
    progress = read_json(path) if path.exists() else {"manifest_sha256": digest(manifest), "verified": {}}
    if progress["manifest_sha256"] != digest(manifest):
        raise CopyError("Manifest changed; refusing to reuse old verification receipts")
    for key, checksum in progress["verified"].items():
        if key not in manifest["files"] or checksum != manifest["files"][key]["sha256"]:
            raise CopyError("Verification receipt does not match the manifest")
    return progress


def ensure_unchanged(root, manifest, database):
    if digest(database) != manifest["database_sha256"]:
        raise CopyError("Database references or job states changed; do not switch storage")
    if snapshot(root) != manifest["files"]:
        raise CopyError("Local file set or content changed; do not switch storage")


def copy_batch(root, state, manifest, store, database, budget=BATCH_BYTES):
    ensure_unchanged(root, manifest, database)
    progress = load_progress(state, manifest)
    selected = []
    batch_bytes = 0
    for key, info in manifest["files"].items():
        if key in progress["verified"]:
            continue
        if selected and batch_bytes + info["size"] > budget:
            break
        selected.append(key)
        batch_bytes += info["size"]
    for key in selected:
        info = manifest["files"][key]
        source = root / key
        content_type = manifest["content_types"].get(key) or mimetypes.guess_type(key)[0] or "application/octet-stream"
        # Worker 的上传适配器使用 x-upsert=false；已有对象仅在 SHA-256 相同时接受。
        store.upload(key, source, content_type)
        with tempfile.TemporaryDirectory(prefix="studio-copy-readback-") as directory:
            target = Path(directory) / "object"
            store.download(key, target, max(1, info["size"]))
            actual = fingerprint(target)
            if actual["size"] != info["size"] or actual["sha256"] != info["sha256"]:
                raise CopyError("Remote readback differs from the source manifest")
        if fingerprint(source) != info:
            raise CopyError("Source changed during copying; current object is not checkpointed")
        progress["verified"][key] = info["sha256"]
        write_json(state / "progress.json", progress)
        print(f"VERIFIED {len(progress['verified'])}/{len(manifest['files'])}", flush=True)
    return summary(manifest, progress)


def summary(manifest, progress=None):
    files = manifest["files"]
    verified = (progress or {}).get("verified", {})
    return {"files": len(files), "bytes": sum(item["size"] for item in files.values()),
            "verified": len(verified), "remaining": len(files) - len(verified),
            "complete": len(files) == len(verified), "bucket": BUCKET,
            "reference_counts": manifest["reference_counts"]}


@contextmanager
def state_lock():
    import fcntl

    fd = os.open(STATE / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "r+") as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["plan", "copy", "status", "finish"])
    args = parser.parse_args()
    if os.name != "posix" or not Path("/.dockerenv").exists():
        raise CopyError("Run inside the existing Worker image, not on the host")
    if not STATE.is_dir() or STATE.is_symlink() or STATE.resolve() != STATE:
        raise CopyError("A dedicated /migration-state directory mount is required")
    if not os.statvfs(SOURCE).f_flag & os.ST_RDONLY:
        raise CopyError("Source asset volume MUST be mounted read-only")
    if os.getenv("STUDIO_SUPABASE_URL", "").rstrip("/") != ORIGIN or os.getenv("STUDIO_SUPABASE_BUCKET") != BUCKET:
        raise CopyError("This tool is restricted to the approved new Studio test bucket")

    def deadline(*_):
        raise CopyTimeout("Ten-minute limit reached; do not automatically repeat this timed-out batch")

    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(MAX_SECONDS)
    with state_lock():
        if args.action == "plan":
            manifest = plan(SOURCE, STATE, database_snapshot())
            print("PLAN " + json.dumps(summary(manifest)), flush=True)
            return
        manifest = load_manifest(STATE)
        progress = load_progress(STATE, manifest)
        if args.action == "status":
            print("STATUS " + json.dumps(summary(manifest, progress)), flush=True)
            return
        from worker.supabase_storage import SupabaseStorage

        store = SupabaseStorage()
        store.probe()
        if args.action == "copy":
            result = copy_batch(SOURCE, STATE, manifest, store, database_snapshot())
            print("BATCH " + json.dumps(result), flush=True)
        else:
            ensure_unchanged(SOURCE, manifest, database_snapshot())
            result = summary(manifest, progress)
            if not result["complete"]:
                raise CopyError("Copy is not complete; storage must remain local")
            write_json(STATE / "verified.json", {"manifest_sha256": digest(manifest),
                       "verified_at": int(time.time()), **result})
            print("READY_FOR_REVIEW " + json.dumps(result), flush=True)
            print("Storage has NOT been switched. Source files and database are unchanged.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # 不输出任意网络/数据库异常正文，避免泄露连接串、凭据或签名 URL。
        detail = str(error) if isinstance(error, CopyError) else type(error).__name__
        print("FAIL: " + detail, flush=True)
        raise SystemExit(124 if isinstance(error, CopyTimeout) else 1)
