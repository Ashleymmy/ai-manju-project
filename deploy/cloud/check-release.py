"""只读检查发布 Compose；不解析 runtime env、不拉镜像、不启动或修改服务。"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
SERVICES = {
    "postgres", "redis", "api", "worker", "asset-export-worker", "sd-video-bridge", "web", "edge",
    "sd-video-postgres", "sd-video-redis", "sd-video-api", "sd-video-worker", "sd-video-asset-worker",
}
APPLICATIONS = {"api", "worker", "asset-export-worker", "sd-video-bridge",
                "sd-video-api", "sd-video-worker", "sd-video-asset-worker"}
DIGEST = re.compile(r"^[^\s@]+@sha256:[a-f0-9]{64}$")


def inspect_release(config: dict) -> list[str]:
    errors = []
    services = config.get("services", {})
    for name in sorted(SERVICES - services.keys()):
        errors.append(f"{name}: required service missing")
    for name, service in services.items():
        image = service.get("image", "")
        if not DIGEST.fullmatch(image) or ".invalid" in image:
            errors.append(f"{name}: tested registry image digest required")
        if "build" in service:
            errors.append(f"{name}: cloud deployment must not build on the server")
        if service.get("privileged") or service.get("network_mode") == "host":
            errors.append(f"{name}: privileged or host-network execution is forbidden")
        if service.get("ports") and name != "edge":
            errors.append(f"{name}: only edge may publish host ports")
        if not service.get("healthcheck", {}).get("test") or service.get("healthcheck", {}).get("disable"):
            errors.append(f"{name}: explicit healthcheck required")
        if name in APPLICATIONS:
            if not service.get("read_only"):
                errors.append(f"{name}: application filesystem must be read-only")
            if not service.get("env_file"):
                errors.append(f"{name}: separate runtime env file required")
        if not service.get("mem_limit"):
            errors.append(f"{name}: memory limit required")
    edge = services.get("edge", {})
    ports = edge.get("ports", [])
    if len(ports) != 1 or str(ports[0].get("published")) != "443" or ports[0].get("target") != 443:
        errors.append("edge: only HTTPS 443 may be published")
    domain = edge.get("environment", {}).get("STUDIO_DOMAIN", "")
    if not domain or ".invalid" in domain or not re.fullmatch(r"[A-Za-z0-9.-]+", domain):
        errors.append("edge: test domain is not configured")
    api_dependencies = services.get("api", {}).get("depends_on", {})
    web_dependencies = services.get("web", {}).get("depends_on", {})
    if any(name.startswith("sd-video") for name in api_dependencies) or "asset-export-worker" in web_dependencies:
        errors.append("Studio: optional background services must not block non-video startup")
    for name in ("studio-private", "sdvideo-private", "service-link"):
        if not config.get("networks", {}).get(name, {}).get("internal"):
            errors.append(f"{name}: internal network required")
    studio_env = services.get("api", {}).get("env_file")
    sdvideo_env = services.get("sd-video-api", {}).get("env_file")
    if studio_env and studio_env == sdvideo_env:
        errors.append("Studio and SD-video must not share a runtime env file")
    if services.get("worker", {}).get("command") != ["python", "-m", "worker.runtime"]:
        errors.append("worker: supervised runtime required")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose-env", type=Path, required=True, help="仅 Compose 参数文件，不是 runtime env")
    parser.add_argument("--storage-tokens", action="store_true")
    args = parser.parse_args()
    command = ["docker", "compose", "--env-file", str(args.compose_env.resolve()), "-f", str(HERE / "compose.yml")]
    if args.storage_tokens:
        command.extend(["-f", str(HERE / "compose.storage-tokens.yml")])
    command.extend(["config", "--no-env-resolution", "--format", "json"])
    # 不继承本机数据库/模型/Compose 覆盖变量，也不自动读取项目 .env。
    environment = {key: value for key, value in os.environ.items() if key.upper() in {
        "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE",
        "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PATHEXT",
    }}
    environment["COMPOSE_DISABLE_ENV_FILE"] = "1"
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", env=environment, timeout=30)
        if result.returncode:
            # Compose 的原错误可能回显变量值，不直接输出。
            raise ValueError("compose rendering failed")
        errors = inspect_release(json.loads(result.stdout))
    except (OSError, ValueError, subprocess.TimeoutExpired):
        print("FAIL: Compose parameters could not be rendered; no services were changed.")
        return 2
    for error in errors:
        print("FAIL: " + error)
    if errors:
        return 1
    print("PASS: static release configuration only; image content, runtime secrets, NAS, TLS and live health remain unverified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
