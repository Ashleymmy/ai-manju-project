"""仅在隔离 Linux 容器运行：真实非 root 接收进程与两组只读身份验收。"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from uuid import uuid4

import importlib.util
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

HERE = Path(__file__).resolve().parent
RECEIVER_UID = 21000
STUDIO_GID = 21001
SDVIDEO_GID = 21002


def main():
    if sys.platform != "linux" or os.geteuid() != 0 or not Path("/.dockerenv").exists():
        raise RuntimeError("Run only inside a new isolated Linux Docker container as root")
    spec = importlib.util.spec_from_file_location("test_issuer", HERE / "storage-token.py")
    issuer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(issuer)
    with tempfile.TemporaryDirectory(prefix="studio-token-permissions-") as temporary:
        root = Path(temporary)
        root.chmod(0o755)
        key = Ed25519PrivateKey.generate()
        public = root / "public.json"
        public.write_text(json.dumps(issuer.public_jwks(key, "permission-test")))
        public.chmod(0o644)
        targets = {
            "studio": {"subject": str(uuid4()), "buckets": ["studio-test-assets"], "group_id": STUDIO_GID},
            "sdvideo": {"subject": str(uuid4()), "buckets": ["studio-sdvideo-test-inputs", "studio-sdvideo-test-results", "studio-sdvideo-test-thumbnails", "studio-sdvideo-test-volcano"], "group_id": SDVIDEO_GID},
        }
        tokens = {}
        for name, target in targets.items():
            directory = root / name
            directory.mkdir(mode=0o750)
            os.chown(directory, RECEIVER_UID, target["group_id"])
            target["directory"] = str(directory)
            tokens[name] = issuer.mint(key, "permission-test", target["subject"], name + "_storage_service", target["buckets"])
        config = root / "receiver.json"
        config.write_text(json.dumps({"public_jwks_file": str(public), "targets": targets}))
        config.chmod(0o644)
        command = [sys.executable, str(HERE / "storage-token-sync.py"), "receive", "--config", str(config)]
        environment = {**os.environ, "SSH_ORIGINAL_COMMAND": "storage-token-receive", "PYTHONDONTWRITEBYTECODE": "1"}
        for _ in range(2):
            result = subprocess.run(command, input=json.dumps({"version": 1, "tokens": tokens}), text=True,
                capture_output=True, timeout=10, env=environment, user=RECEIVER_UID, group=RECEIVER_UID,
                extra_groups=[STUDIO_GID, SDVIDEO_GID])
            if result.returncode or not json.loads(result.stdout)["success"]:
                raise RuntimeError("Non-root receiver installation failed")
        print("PASS: non-root receiver validates real config, installs and re-installs both tokens")
        read_probe = """
import os, pathlib, sys
own, other = map(pathlib.Path, sys.argv[1:])
assert own.read_bytes()
assert not os.access(own, os.W_OK)
try:
    other.read_bytes()
except PermissionError:
    pass
else:
    raise AssertionError('cross-service token became readable')
"""
        for name, other in [("studio", "sdvideo"), ("sdvideo", "studio")]:
            result = subprocess.run([sys.executable, "-c", read_probe, str(root / name / "storage-token"),
                str(root / other / "storage-token")], capture_output=True, timeout=10, user=22000,
                group=targets[name]["group_id"], extra_groups=[])
            if result.returncode:
                raise RuntimeError("Service token read isolation failed")
        print("PASS: both service groups can read only their own token and cannot modify it")
        result = subprocess.run([sys.executable, str(HERE / "storage-token-sync.py"), "check", "--config", str(config)],
            capture_output=True, timeout=10, user=RECEIVER_UID, group=RECEIVER_UID, extra_groups=[STUDIO_GID, SDVIDEO_GID])
        if result.returncode or not json.loads(result.stdout)["success"]:
            raise RuntimeError("Receiver health check failed")
        print("PASS: non-root health check confirms both tokens are fresh; temporary fixtures removed on exit")


if __name__ == "__main__":
    main()
