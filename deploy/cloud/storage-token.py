"""受信存储端的独立 Ed25519 签发工具；云端只接收短期 Token，不接收私钥。"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import tempfile
import time
import uuid
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

MAX_LIFETIME = 300


def encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def public_jwks(key: Ed25519PrivateKey, kid: str) -> dict:
    public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return {"keys": [{"kty": "OKP", "crv": "Ed25519", "x": encode(public), "alg": "EdDSA", "use": "sig", "kid": kid}]}


def validate_scope(kid: str, subject: str, role: str, buckets: list[str], lifetime: int = MAX_LIFETIME):
    uuid.UUID(subject)  # 兼容 Storage 旧 owner UUID 列；身份与 Studio 用户无关。
    if not kid or not 30 <= lifetime <= MAX_LIFETIME or not buckets or len(set(buckets)) != len(buckets):
        raise ValueError("Invalid scoped Storage token configuration")
    if role == "studio_storage_service":
        allowed = len(buckets) == 1 and all(re.fullmatch(r"studio-[a-z0-9][a-z0-9-]{1,60}", b) and not b.startswith("studio-sdvideo-") for b in buckets)
    elif role == "sdvideo_storage_service":
        allowed = len(buckets) == 4 and all(re.fullmatch(r"studio-sdvideo-[a-z0-9][a-z0-9-]{1,45}", b) for b in buckets)
    else:
        allowed = False
    if not allowed:
        raise ValueError("Role and dedicated buckets do not match")


def mint(key: Ed25519PrivateKey, kid: str, subject: str, role: str, buckets: list[str], lifetime: int = MAX_LIFETIME) -> str:
    validate_scope(kid, subject, role, buckets, lifetime)
    now = int(time.time())
    header = {"alg": "EdDSA", "typ": "JWT", "kid": kid}
    payload = {"iss": "studio-storage-issuer", "sub": subject, "role": role, "iat": now,
               "exp": now + lifetime, "jti": str(uuid.uuid4()), "storage_buckets": buckets}
    message = ".".join(encode(json.dumps(value, separators=(",", ":")).encode()) for value in (header, payload))
    return message + "." + encode(key.sign(message.encode("ascii")))


def atomic_token(path: Path, token: str, *, group_id: int | None = None):
    # 目录必须预先建立并限制权限；不跟随目标符号链接，不打印令牌。
    if path.is_symlink():
        raise ValueError("Token destination must not be a symlink")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".storage-token-", delete=False) as stream:
            temporary = Path(stream.name)
            if os.name != "nt":
                if group_id is not None:
                    os.fchown(stream.fileno(), -1, group_id)
                os.fchmod(stream.fileno(), 0o440 if group_id is not None else 0o600)
            stream.write(token.encode("ascii"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file", type=Path, required=True)
    parser.add_argument("--kid", required=True)
    parser.add_argument("--init-key", action="store_true", help="只在本地受信端创建全新私钥，拒绝覆盖")
    parser.add_argument("--public-jwks", action="store_true", help="只输出公钥，供运维合并到 Storage JWT_JWKS")
    parser.add_argument("--role", choices=["studio_storage_service", "sdvideo_storage_service"])
    parser.add_argument("--subject")
    parser.add_argument("--bucket", action="append", default=[])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.init_key:
        key = Ed25519PrivateKey.generate()
        data = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        fd = os.open(args.key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        print("Created new Storage signing key; keep it on the trusted storage host.")
        return
    key = serialization.load_pem_private_key(args.key_file.read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("A dedicated Ed25519 private key is required")
    if args.public_jwks:
        print(json.dumps(public_jwks(key, args.kid)))
        return
    if not args.subject or not args.role or not args.output:
        parser.error("Signing requires --subject, --role, --bucket and --output")
    atomic_token(args.output, mint(key, args.kid, args.subject, args.role, args.bucket))
    print("Scoped Storage token written; expires in 300 seconds.")


if __name__ == "__main__":
    main()
