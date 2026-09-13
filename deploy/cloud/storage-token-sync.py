"""本地签发并经受限 SSH 分发；云端仅验签、原子安装与检查短期令牌。"""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import uuid

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

SPEC = importlib.util.spec_from_file_location("storage_token_issuer", Path(__file__).with_name("storage-token.py"))
issuer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(issuer)

MAX_MESSAGE_BYTES = 32768
MIN_INSTALL_LIFETIME = 180
HEALTH_LIFETIME = 120
SSH_TIMEOUT = 35
REMOTE_COMMAND = "storage-token-receive"
ROLES = {"studio": "studio_storage_service", "sdvideo": "sdvideo_storage_service"}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate configuration or payload field")
        result[key] = value
    return result


def parse_json(data):
    return json.loads(data, object_pairs_hook=unique_object)


def checked_path(value: str, *, private: bool = False, directory: bool = False) -> Path:
    path = Path(value)
    # 固定绝对路径且拒绝各层符号链接，避免令牌写入其他 Secret 目录。
    if not path.is_absolute() or path.resolve(strict=True) != path.absolute():
        raise ValueError("An existing absolute path without symlinks is required")
    info = path.stat()
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        raise ValueError("Unexpected path type")
    if os.name != "nt":
        forbidden = 0o077 if private else 0o022
        if stat.S_IMODE(info.st_mode) & forbidden:
            raise ValueError("Unsafe path permissions")
    return path


def load_config(path: Path, receiver: bool) -> dict:
    config = parse_json(checked_path(str(path)).read_bytes())
    if set(config["targets"]) != set(ROLES):
        raise ValueError("Exactly two isolated service targets are required")
    subjects, directories, groups = set(), set(), set()
    for name, target in config["targets"].items():
        subject = str(uuid.UUID(target["subject"]))
        if subject != target["subject"] or subject in subjects:
            raise ValueError("Distinct canonical machine UUIDs are required")
        subjects.add(subject)
        issuer.validate_scope("validate-config", subject, ROLES[name], target["buckets"])
        if receiver:
            directory = checked_path(target["directory"], directory=True)
            group = target["group_id"]
            if type(group) is not int or group <= 0 or group in groups or directory in directories:
                raise ValueError("Distinct token directories and non-root read groups are required")
            if os.name != "nt" and directory.stat().st_uid != os.geteuid():
                raise ValueError("Receiver must own its token-only directories")
            if os.name != "nt" and stat.S_IMODE(directory.stat().st_mode) != 0o750:
                raise ValueError("Token directory permissions must be 0750")
            if os.name != "nt" and directory.stat().st_gid != group:
                raise ValueError("Token directory must belong to its service read group")
            directories.add(directory)
            groups.add(group)
    if receiver:
        first, second = directories
        if first in second.parents or second in first.parents:
            raise ValueError("Token directories must not be nested")
        checked_path(config["public_jwks_file"])
        if "private_key_file" in config:
            raise ValueError("Cloud receiver must not have a signing private key")
    else:
        checked_path(config["private_key_file"], private=True)
        checked_path(config["ssh"]["identity_file"], private=True)
        checked_path(config["ssh"]["known_hosts_file"])
    return config


def decode_part(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("Invalid JWT encoding")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def verify_token(token: str, name: str, target: dict, jwks: dict, *, minimum: int | None) -> dict:
    if not isinstance(token, str) or len(token) > 8192:
        raise ValueError("Invalid JWT size")
    header_part, payload_part, signature = token.split(".")
    header = parse_json(decode_part(header_part))
    claims = parse_json(decode_part(payload_part))
    if set(header) != {"alg", "kid", "typ"} or header["alg"] != "EdDSA" or header["typ"] != "JWT":
        raise ValueError("Unexpected JWT header")
    matches = [key for key in jwks["keys"] if key.get("kid") == header["kid"]]
    if len(matches) != 1:
        raise ValueError("Untrusted or duplicate key ID")
    public = matches[0]
    if public.get("kty") != "OKP" or public.get("crv") != "Ed25519" or public.get("alg") != "EdDSA" or public.get("use") != "sig":
        raise ValueError("Unexpected verification key")
    Ed25519PublicKey.from_public_bytes(decode_part(public["x"])).verify(
        decode_part(signature), (header_part + "." + payload_part).encode("ascii"))
    expected = {"iss", "sub", "role", "iat", "exp", "jti", "storage_buckets"}
    if set(claims) != expected or claims["iss"] != "studio-storage-issuer" or claims["sub"] != target["subject"] or claims["role"] != ROLES[name]:
        raise ValueError("Unexpected machine identity")
    if claims["storage_buckets"] != target["buckets"]:
        raise ValueError("Bucket scope does not match receiver policy")
    uuid.UUID(claims["jti"])
    issued, expires = claims["iat"], claims["exp"]
    if type(issued) is not int or type(expires) is not int or not 30 <= expires - issued <= issuer.MAX_LIFETIME:
        raise ValueError("Invalid token lifetime")
    if minimum is not None and (issued > int(time.time()) or expires - int(time.time()) < minimum):
        raise ValueError("Token expired, not yet valid or renewal is overdue")
    return claims


@contextmanager
def receiver_lock(config: dict):
    path = Path(config["targets"]["studio"]["directory"]) / ".storage-token-sync.lock"
    if path.is_symlink():
        raise ValueError("Lock destination must not be a symlink")
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "rb+") as stream:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def receive(config: dict, data: bytes) -> dict:
    # 同一接收机跨 SSH 连接串行安装；进程退出/崩溃由内核释放锁。
    with receiver_lock(config):
        return install_batch(config, data)


def install_batch(config: dict, data: bytes) -> dict:
    if len(data) > MAX_MESSAGE_BYTES:
        raise ValueError("Payload too large")
    payload = parse_json(data)
    if set(payload) != {"version", "tokens"} or payload["version"] != 1 or set(payload["tokens"]) != set(ROLES):
        raise ValueError("Unexpected delivery payload")
    jwks = parse_json(Path(config["public_jwks_file"]).read_bytes())
    pending = []
    # 两份令牌全部验签、校验身份和防回退之后才开始写入。
    for name, target in config["targets"].items():
        token = payload["tokens"][name]
        claims = verify_token(token, name, target, jwks, minimum=MIN_INSTALL_LIFETIME)
        destination = Path(target["directory"]) / "storage-token"
        if destination.is_symlink():
            raise ValueError("Token destination must not be a symlink")
        if destination.exists():
            old = verify_token(destination.read_text(encoding="ascii"), name, target, jwks, minimum=None)
            if claims["iat"] < old["iat"] or claims["exp"] < old["exp"]:
                raise ValueError("Out-of-order token delivery")
        pending.append((destination, token, target["group_id"]))
    for destination, token, group in pending:
        issuer.atomic_token(destination, token, group_id=group)
    return {"success": True, "sha256": hashlib.sha256(data).hexdigest()}


def ssh_command(config: dict) -> list[str]:
    ssh = config["ssh"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.:-]*", ssh["host"]) or not re.fullmatch(r"[a-z_][a-z0-9_-]*", ssh["user"]):
        raise ValueError("Invalid SSH host or user")
    if type(ssh["port"]) is not int or not 1 <= ssh["port"] <= 65535:
        raise ValueError("Invalid SSH port")
    # 不加载用户 SSH 配置，不经 shell，不回显 stdout/stderr 或 Token。
    return ["ssh", "-F", os.devnull, "-T", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
            "-o", "StrictHostKeyChecking=yes", "-o", "GlobalKnownHostsFile=" + os.devnull,
            "-o", "UserKnownHostsFile=" + ssh["known_hosts_file"], "-o", "ConnectTimeout=10",
            "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
            "-o", "ClearAllForwardings=yes", "-o", "ForwardAgent=no",
            "-i", ssh["identity_file"], "-p", str(ssh["port"]), "-l", ssh["user"],
            ssh["host"], REMOTE_COMMAND]


def publish(config: dict):
    key = serialization.load_pem_private_key(Path(config["private_key_file"]).read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("Dedicated Ed25519 signing key required")
    payload = {"version": 1, "tokens": {
        name: issuer.mint(key, config["kid"], target["subject"], ROLES[name], target["buckets"])
        for name, target in config["targets"].items()}}
    data = json.dumps(payload, separators=(",", ":")).encode("ascii")
    result = subprocess.run(ssh_command(config), input=data, capture_output=True, timeout=SSH_TIMEOUT, check=False)
    if result.returncode != 0 or len(result.stdout) > MAX_MESSAGE_BYTES:
        raise RuntimeError("SSH delivery failed; inspect restricted receiver health")
    receipt = parse_json(result.stdout)
    if receipt != {"success": True, "sha256": hashlib.sha256(data).hexdigest()}:
        raise RuntimeError("Receiver did not acknowledge this token batch")


def health(config: dict) -> dict:
    jwks = parse_json(Path(config["public_jwks_file"]).read_bytes())
    remaining = {}
    for name, target in config["targets"].items():
        destination = checked_path(str(Path(target["directory"]) / "storage-token"))
        claims = verify_token(destination.read_text(encoding="ascii"), name, target, jwks, minimum=HEALTH_LIFETIME)
        remaining[name] = claims["exp"] - int(time.time())
    return {"success": True, "remaining_seconds": remaining}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["publish", "receive", "check"])
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    try:
        config = load_config(args.config, receiver=args.action != "publish")
        if args.action == "publish":
            publish(config)
            print("Storage token batch delivered and acknowledged; lifetime 300 seconds.")
        elif args.action == "receive":
            if os.environ.get("SSH_ORIGINAL_COMMAND") != REMOTE_COMMAND:
                raise ValueError("Only the restricted SSH receive command is allowed")
            # 限制长度，不接受客户端指定文件路径、shell 命令或新增桶。
            print(json.dumps(receive(config, sys.stdin.buffer.read(MAX_MESSAGE_BYTES + 1))))
        else:
            print(json.dumps(health(config)))
        return 0
    except Exception as error:
        # 异常可能含命令、签名材料或远端输出，只向监控暴露动作和失败状态。
        print(f"Storage token {args.action} failed ({type(error).__name__}); check configuration, clock, transport and receiver health.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
