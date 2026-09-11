"""运维签发工具回归，与 SD-video 独立运行时分开。"""
import base64
import importlib.util
import json
from pathlib import Path
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def tool():
    filename = Path(__file__).resolve().parents[1] / "storage-token.py"
    spec = importlib.util.spec_from_file_location("storage_token_tool", filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_dedicated_issuer_signatures_and_atomic_rotation(tmp_path):
    issuer = tool()
    key = Ed25519PrivateKey.generate()
    subject = str(uuid4())
    value = issuer.mint(key, "test-kid", subject, "studio_storage_service", ["studio-test-assets"])
    claims = jwt.decode(value, key.public_key(), algorithms=["EdDSA"], issuer="studio-storage-issuer")
    assert claims["exp"] - claims["iat"] == 300 and claims["sub"] == subject
    assert issuer.public_jwks(key, "test-kid")["keys"][0]["kty"] == "OKP"
    with pytest.raises(jwt.InvalidSignatureError): jwt.decode(value, Ed25519PrivateKey.generate().public_key(), algorithms=["EdDSA"])
    filename = tmp_path / "token"
    issuer.atomic_token(filename, value)
    second = issuer.mint(key, "test-kid", subject, "studio_storage_service", ["studio-test-assets"])
    issuer.atomic_token(filename, second)
    assert filename.read_text() == second and second != value
    assert list(tmp_path.iterdir()) == [filename]
    claims["exp"] += 3600
    parts = value.split(".")
    parts[1] = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    with pytest.raises(jwt.InvalidSignatureError): jwt.decode(".".join(parts), key.public_key(), algorithms=["EdDSA"])


@pytest.mark.parametrize("role,buckets,ttl", [("service_role", ["private"], 300),
    ("studio_storage_service", ["private"], 300), ("studio_storage_service", ["studio-test-assets"], 3600),
    ("studio_storage_service", ["studio-sdvideo-test-results"], 300),
    ("sdvideo_storage_service", ["studio-sdvideo-test-results"], 300)])
def test_issuer_refuses_privileged_or_overscoped_tokens(role, buckets, ttl):
    with pytest.raises(ValueError): tool().mint(Ed25519PrivateKey.generate(), "kid", str(uuid4()), role, buckets, ttl)
