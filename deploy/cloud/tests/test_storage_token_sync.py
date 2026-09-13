"""合成密钥和临时目录验证续期、安装与隔离，不连接云端或真实 NAS。"""
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def tool():
    filename = Path(__file__).resolve().parents[1] / "storage-token-sync.py"
    spec = importlib.util.spec_from_file_location("storage_token_sync", filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def setup(tmp_path, monkeypatch):
    sync = tool()
    key = Ed25519PrivateKey.generate()
    keyfile = tmp_path / "key.pem"
    keyfile.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    keyfile.chmod(0o600)
    public = tmp_path / "public.json"
    public.write_text(json.dumps(sync.issuer.public_jwks(key, "test-key")), encoding="utf-8")
    targets = {
        "studio": {"subject": str(uuid4()), "buckets": ["studio-test-assets"]},
        "sdvideo": {"subject": str(uuid4()), "buckets": ["studio-sdvideo-test-inputs", "studio-sdvideo-test-results", "studio-sdvideo-test-thumbnails", "studio-sdvideo-test-volcano"]},
    }
    for name, target in targets.items():
        directory = tmp_path / name
        directory.mkdir(mode=0o750)
        target.update(directory=str(directory), group_id=os.getgid() if os.name != "nt" else 21001)
    config = {"private_key_file": str(keyfile), "kid": "test-key", "public_jwks_file": str(public), "targets": targets,
              "ssh": {"host": "unreachable.example.invalid", "user": "storage-token-receiver", "port": 22,
                      "identity_file": str(keyfile), "known_hosts_file": str(public)}}
    clock = [2000000000]
    monkeypatch.setattr(sync.time, "time", lambda: clock[0])
    return SimpleNamespace(sync=sync, key=key, config=config, clock=clock, directory=tmp_path)


def batch(state, *, key=None):
    return json.dumps({"version": 1, "tokens": {
        name: state.sync.issuer.mint(key or state.key, "test-key", target["subject"], state.sync.ROLES[name], target["buckets"])
        for name, target in state.config["targets"].items()}}).encode()


def installed(state):
    return {name: (Path(target["directory"]) / "storage-token").read_bytes()
            for name, target in state.config["targets"].items()}


def test_receive_rotates_both_services_and_health_detects_missed_renewal(setup):
    state = setup
    state.sync.receive(state.config, batch(state))
    first = installed(state)
    assert state.sync.health(state.config)["remaining_seconds"] == {"studio": 300, "sdvideo": 300}
    state.clock[0] += 60
    state.sync.receive(state.config, batch(state))
    assert all(installed(state)[name] != first[name] for name in first)
    if os.name != "nt":
        assert (state.directory / "studio/storage-token").stat().st_mode & 0o777 == 0o440
    state.clock[0] += 181
    with pytest.raises(ValueError, match="overdue"):
        state.sync.health(state.config)
    assert installed(state)


@pytest.mark.parametrize("bad", ["signature", "role", "subject", "buckets", "expired", "future", "oversized", "missing", "extra", "duplicate"])
def test_bad_batch_never_replaces_existing_tokens(setup, bad):
    state = setup
    state.sync.receive(state.config, batch(state))
    before = installed(state)
    if bad == "signature":
        data = batch(state, key=Ed25519PrivateKey.generate())
    elif bad in {"expired", "future"}:
        state.clock[0] += -200 if bad == "expired" else 10
        data = batch(state)
        state.clock[0] += 200 if bad == "expired" else -10
    elif bad in {"role", "subject", "buckets"}:
        payload = json.loads(batch(state))
        target = state.config["targets"]["sdvideo"]
        if bad == "role":
            token = payload["tokens"]["studio"]
        else:
            token = state.sync.issuer.mint(state.key, "test-key", str(uuid4()) if bad == "subject" else target["subject"],
                        "sdvideo_storage_service", ["studio-sdvideo-wrong-" + str(i) for i in range(4)] if bad == "buckets" else target["buckets"])
        payload["tokens"]["sdvideo"] = token
        data = json.dumps(payload).encode()
    elif bad == "oversized":
        data = b" " * (state.sync.MAX_MESSAGE_BYTES + 1)
    elif bad == "duplicate":
        data = b'{"version":1,"version":1,"tokens":{}}'
    else:
        payload = json.loads(batch(state))
        if bad == "missing":
            del payload["tokens"]["studio"]
        else:
            payload["tokens"]["arbitrary-path"] = "bad"
        data = json.dumps(payload).encode()
    with pytest.raises(Exception):
        state.sync.receive(state.config, data)
    assert installed(state) == before


def test_replay_cannot_roll_back_newer_tokens_and_lock_prevents_race(setup):
    state = setup
    old = batch(state)
    state.sync.receive(state.config, old)
    state.clock[0] += 60
    new = batch(state)
    state.sync.receive(state.config, new)
    before = installed(state)
    with pytest.raises(ValueError, match="Out-of-order"):
        state.sync.receive(state.config, old)
    with state.sync.receiver_lock(state.config):
        with pytest.raises(OSError):
            state.sync.receive(state.config, new)
    assert installed(state) == before
    assert state.sync.receive(state.config, new)["success"]


def test_atomic_write_failure_retains_previous_token_and_next_cycle_recovers(setup, monkeypatch):
    state = setup
    state.sync.receive(state.config, batch(state))
    before = installed(state)
    state.clock[0] += 60
    replace = state.sync.issuer.os.replace
    def fail_second(source, destination):
        if "sdvideo" in str(destination):
            raise OSError("simulated filesystem error")
        return replace(source, destination)
    with monkeypatch.context() as scope:
        scope.setattr(state.sync.issuer.os, "replace", fail_second)
        with pytest.raises(OSError):
            state.sync.receive(state.config, batch(state))
    assert installed(state)["sdvideo"] == before["sdvideo"]
    assert not list((state.directory / "sdvideo").glob(".storage-token-*"))
    state.clock[0] += 60
    state.sync.receive(state.config, batch(state))
    assert all(installed(state)[name] != before[name] for name in before)


def test_publisher_uses_stdin_pinned_ssh_and_matching_receipt(setup, monkeypatch):
    state = setup
    def transport(command, **kwargs):
        assert command[-1] == "storage-token-receive"
        assert "StrictHostKeyChecking=yes" in command
        assert "BatchMode=yes" in command and "ForwardAgent=no" in command
        assert kwargs["timeout"] == 35 and "shell" not in kwargs
        assert all("eyJ" not in arg for arg in command)
        receipt = state.sync.receive(state.config, kwargs["input"])
        return SimpleNamespace(returncode=0, stdout=json.dumps(receipt).encode(), stderr=b"")
    monkeypatch.setattr(state.sync.subprocess, "run", transport)
    state.sync.publish(state.config)
    assert state.sync.health(state.config)["success"]


@pytest.mark.parametrize("failure", ["exit", "receipt", "timeout"])
def test_failed_transport_is_not_reported_as_success(setup, monkeypatch, failure):
    state = setup
    def transport(*args, **kwargs):
        if failure == "timeout":
            raise state.sync.subprocess.TimeoutExpired(args[0], 35)
        return SimpleNamespace(returncode=1 if failure == "exit" else 0, stdout=b'{"success":true}', stderr=b"sensitive remote output")
    monkeypatch.setattr(state.sync.subprocess, "run", transport)
    with pytest.raises(Exception):
        state.sync.publish(state.config)


def test_cli_sanitizes_remote_errors_and_never_prints_token(setup, monkeypatch, capsys):
    state = setup
    monkeypatch.setattr(state.sync, "load_config", lambda *args, **kwargs: state.config)
    def failed(config):
        raise RuntimeError("sensitive JWT and private key material")
    monkeypatch.setattr(state.sync, "publish", failed)
    monkeypatch.setattr(state.sync.sys, "argv", ["storage-token-sync.py", "publish", "--config", "unused"])
    assert state.sync.main() == 1
    captured = capsys.readouterr()
    assert captured.out == "" and "sensitive" not in captured.err and "RuntimeError" in captured.err


def test_ssh_command_injection_and_remote_command_rejected(setup, monkeypatch, capsys):
    state = setup
    state.config["ssh"]["host"] = "-oProxyCommand=bad"
    with pytest.raises(ValueError):
        state.sync.ssh_command(state.config)
    monkeypatch.setattr(state.sync, "load_config", lambda *args, **kwargs: state.config)
    monkeypatch.setattr(state.sync.sys, "argv", ["storage-token-sync.py", "receive", "--config", "unused"])
    monkeypatch.setenv("SSH_ORIGINAL_COMMAND", "arbitrary-shell")
    assert state.sync.main() == 1
    assert "arbitrary-shell" not in capsys.readouterr().err


def test_existing_symlink_is_not_replaced(setup):
    state = setup
    outside = state.directory / "unrelated-secret"
    outside.write_text("unchanged")
    destination = state.directory / "studio/storage-token"
    destination.symlink_to(outside)
    with pytest.raises(ValueError, match="symlink"):
        state.sync.receive(state.config, batch(state))
    assert outside.read_text() == "unchanged"


def test_configuration_refuses_cloud_private_key_and_shared_identity(setup, monkeypatch):
    state = setup
    configfile = state.directory / "receiver.json"
    # 路径/组权限另由 Linux 集成用例验证；此处独立覆盖配置语义。
    monkeypatch.setattr(state.sync, "checked_path", lambda value, **kwargs: Path(value))
    monkeypatch.setattr(state.sync, "os", SimpleNamespace(name="nt"))
    state.config["targets"]["studio"]["group_id"] = 21001
    state.config["targets"]["sdvideo"]["group_id"] = 21002
    configfile.write_text(json.dumps(state.config))
    with pytest.raises(ValueError, match="private key"):
        state.sync.load_config(configfile, receiver=True)
    del state.config["private_key_file"]
    configfile.write_text(json.dumps(state.config))
    assert state.sync.load_config(configfile, receiver=True)["targets"] == state.config["targets"]
    state.config["targets"]["sdvideo"]["subject"] = state.config["targets"]["studio"]["subject"]
    configfile.write_text(json.dumps(state.config))
    with pytest.raises(ValueError, match="Distinct canonical"):
        state.sync.load_config(configfile, receiver=True)


def test_rotating_public_keys_requires_overlap_until_old_tokens_replaced(setup):
    state = setup
    state.sync.receive(state.config, batch(state))
    old_public = state.sync.issuer.public_jwks(state.key, "test-key")
    state.key = Ed25519PrivateKey.generate()
    state.clock[0] += 60
    # 实際发布采用新 kid；不能覆盖旧公钥，直到已安装令牌换新。
    new_public = state.sync.issuer.public_jwks(state.key, "next-key")
    Path(state.config["public_jwks_file"]).write_text(json.dumps({"keys": old_public["keys"] + new_public["keys"]}))
    payload = {"version": 1, "tokens": {
        name: state.sync.issuer.mint(state.key, "next-key", target["subject"], state.sync.ROLES[name], target["buckets"])
        for name, target in state.config["targets"].items()}}
    assert state.sync.receive(state.config, json.dumps(payload).encode())["success"]
    Path(state.config["public_jwks_file"]).write_text(json.dumps(new_public))
    assert state.sync.health(state.config)["success"]
