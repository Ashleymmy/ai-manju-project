"""
应用配置模块 — 从 .env 文件加载环境变量
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Only load an env file owned by this standalone service.  python-dotenv's
# default parent-directory search would otherwise pick up Studio's root .env
# (or a developer's legacy SD-video checkout), breaking the isolation rule.
if os.getenv("SDVIDEO_LOAD_ENV_FILE", "true").lower() == "true":
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name, "").strip()
    return int(value) if value else default


def _env_choice(name: str, default: str, allowed: set[str]) -> str:
    value = os.getenv(name, default).strip().lower()
    return value if value in allowed else default

def _env_bool(name: str, default: bool = False) -> bool:
    fallback = "true" if default else "false"
    return os.getenv(name, fallback).lower() in ("1", "true", "yes", "on")


def _env_first(*names: str, default: str = "") -> str:
    """Read the first non-empty environment value, including vendor exports."""
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return default


def _secret(name: str) -> str:
    filename = os.getenv(name + "_FILE", "").strip()
    return Path(filename).read_text(encoding="utf-8").strip() if filename else os.getenv(name, "")


def _normalize_url(value: str) -> str:
    value = (value or "").strip().rstrip("/")
    if value and not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    return value



class Settings:
    """集中管理所有配置项"""

    # Standalone service boundary.  These values are intentionally independent
    # from the legacy SD-video deployment and are populated by the new runtime.
    APP_ENV: str = os.getenv("APP_ENV", "development").strip().lower()
    SERVICE_NAME: str = os.getenv("SERVICE_NAME", "sd-video")
    FRONTEND_URLS: tuple[str, ...] = tuple(item.strip() for item in os.getenv("FRONTEND_URLS", "").split(",") if item.strip())
    ALLOW_CORS: bool = _env_bool("ALLOW_CORS", False)
    # ``mock`` is deterministic for local development.  ``provider`` runs the
    # copied Provider adapters through the standalone Worker.  ``legacy`` is a
    # temporary compatibility switch and is rejected in production below.
    EXECUTION_MODE: str = _env_choice("SD_VIDEO_EXECUTION_MODE", "mock", {"mock", "provider", "legacy"})
    SD_VIDEO_MODE: str = _env_choice("SD_VIDEO_MODE", "active", {"disabled", "shadow", "active"})
    SERVICE_JWT_PUBLIC_KEY: str = os.getenv("SERVICE_JWT_PUBLIC_KEY", "")
    SERVICE_JWT_ISSUER: str = os.getenv("SERVICE_JWT_ISSUER", "ai-manju-studio")
    SERVICE_JWT_AUDIENCE: str = os.getenv("SERVICE_JWT_AUDIENCE", "sd-video")
    SERVICE_JWT_ALGORITHMS: tuple[str, ...] = tuple(
        item.strip() for item in os.getenv("SERVICE_JWT_ALGORITHMS", "EdDSA,RS256").split(",") if item.strip()
    )
    SERVICE_TOKEN_LEEWAY_SECONDS: int = _env_int("SERVICE_TOKEN_LEEWAY_SECONDS", 10)
    STORAGE_BACKEND: str = _env_choice("STORAGE_BACKEND", "local", {"supabase", "oss", "s3", "local"})
    API_PREFIX: str = os.getenv("API_PREFIX", "/v1").rstrip("/") or "/v1"
    RESULT_SIGNED_URL_TTL_SECONDS: int = _env_int("RESULT_SIGNED_URL_TTL_SECONDS", 900)
    TASK_POLL_INTERVAL_SECONDS: int = _env_int("TASK_POLL_INTERVAL_SECONDS", 10)
    DATABASE_URL: str = _secret("SDVIDEO_DATABASE_URL")
    REDIS_URL: str = os.getenv("SDVIDEO_REDIS_URL", "")
    DATA_DIR: str = os.getenv("SDVIDEO_DATA_DIR", "./data")
    MAX_INPUT_BYTES: int = _env_int("SDVIDEO_MAX_INPUT_BYTES", 512 * 1024 * 1024)
    MAX_REQUEST_BYTES: int = _env_int("SDVIDEO_MAX_REQUEST_BYTES", 512 * 1024 * 1024)
    WORKER_LEASE_SECONDS: int = _env_int("SDVIDEO_WORKER_LEASE_SECONDS", 120)
    WORKER_MAX_ATTEMPTS: int = _env_int("SDVIDEO_WORKER_MAX_ATTEMPTS", 3)

    # 运行环境
    RELOAD: bool = os.getenv("RELOAD", "false").lower() in ("1", "true", "yes", "on")
    MODEL_RETURN_WAIT_TIMEOUT_SECONDS: int = _env_int("MODEL_RETURN_WAIT_TIMEOUT_SECONDS", 3600)
    LOCAL_DEMO_MODE: bool = os.getenv("LOCAL_DEMO_MODE", "false").lower() in ("1", "true", "yes", "on")
    LOCAL_API_TEST_MODE: bool = os.getenv("LOCAL_API_TEST_MODE", "false").lower() in ("1", "true", "yes", "on")
    LOCAL_DEMO_EMAIL: str = os.getenv("LOCAL_DEMO_EMAIL", "demo@example.com")
    LOCAL_DEMO_PASSWORD: str = os.getenv("LOCAL_DEMO_PASSWORD", "demo123456")
    LOCAL_DEMO_USER_ID: str = os.getenv("LOCAL_DEMO_USER_ID", "local-demo-user")
    LOCAL_ASSET_UPLOAD_BACKEND: str = _env_choice(
        "LOCAL_ASSET_UPLOAD_BACKEND",
        "oss",
        {"oss", "local_tunnel"},
    )
    TEMP_IMAGE_HOST_MAX_BYTES: int = _env_int("TEMP_IMAGE_HOST_MAX_BYTES", 10 * 1024 * 1024)
    TEMP_IMAGE_HOST_TARGET_BYTES: int = _env_int("TEMP_IMAGE_HOST_TARGET_BYTES", 350 * 1024)
    LOCAL_PUBLIC_ASSET_BASE_URL: str = os.getenv("LOCAL_PUBLIC_ASSET_BASE_URL", "").rstrip("/")
    LOCAL_PUBLIC_ASSET_DIR: str = os.getenv("LOCAL_PUBLIC_ASSET_DIR", ".local-public-assets")

    # 火山引擎 Ark API
    ARK_API_KEY: str = _secret("ARK_API_KEY")
    ARK_BASE_URL: str = "https://ark.cn-beijing.volces.com"

    # Seedance 2.0 上游代理 API
    SEEDANCE20_URL: str = os.getenv("SEEDANCE20_URL", "").rstrip("/")
    SEEDANCE20_KEY: str = _secret("SEEDANCE20_KEY")
    SEEDANCE20_PROVIDER: str = _env_choice(
        "SEEDANCE20_PROVIDER",
        "legacy_proxy",
        {"legacy_proxy", "tokenspace"},
    )
    TOKENSPACE_BASE_URL: str = (os.getenv("TOKENSPACE_BASE_URL", "") or "https://api.tokenspace.net.cn").rstrip("/")
    TOKENSPACE_API_KEY: str = _secret("TOKENSPACE_API_KEY")
    TOKENSPACE_MODEL_ID: str = os.getenv("TOKENSPACE_MODEL_ID", "") or "doubao-seedance-2-0-260128"
    TOKENSPACE_ASSET_POLL_CONCURRENCY: int = _env_int("TOKENSPACE_ASSET_POLL_CONCURRENCY", 4)

    SEEDANCE20_MODEL_ID: str = os.getenv("VM_SEEDANCE_20", "") or os.getenv("VM_Seedance20", "doubao-seedance-2-0-260128")
    # Keep the logical 2.5 slot usable in a fresh environment while allowing
    # production to override it with the provider's dedicated model ID.
    SEEDANCE25_MODEL_ID: str = os.getenv("VM_SEEDANCE_25", "") or os.getenv("VM_Seedance25", "") or SEEDANCE20_MODEL_ID
    SEEDANCE20_MINI_MODEL_ID: str = (
        os.getenv("VM_SEEDANCE_20_MINI", "")
        or os.getenv("VM_Seedance20Mini", "")
        or SEEDANCE20_MODEL_ID
    )
    SEEDANCE_FAST_MODEL_ID: str = os.getenv("VM_SEEDANCE_FAST", "") or os.getenv("VM_SeedanceFast", "")

    # 模型标识
    VM_SEEDANCE_20: str = os.getenv("VM_SEEDANCE_20", "") or os.getenv("VM_Seedance20", "doubao-seedance-2-0-260128")
    VM_SEEDANCE_25: str = SEEDANCE25_MODEL_ID
    VM_SEEDANCE_20_MINI: str = (
        os.getenv("VM_SEEDANCE_20_MINI", "")
        or os.getenv("VM_Seedance20Mini", "")
        or SEEDANCE20_MODEL_ID
    )
    VM_SEEDANCE_FAST: str = os.getenv("VM_SEEDANCE_FAST", "") or os.getenv("VM_SeedanceFast", "")
    VM_SEEDANCE_15: str = os.getenv("VM_Seedance15", "doubao-seedance-1-5-pro-251215")
    VM_SEEDANCE_LITE: str = os.getenv("VM_SeedanceLite", "doubao-seedance-1-0-lite-i2v-250428")

    VIDU_BASE_URL: str = (os.getenv("VIDU_BASE_URL", "") or "https://api.vidu.com").rstrip("/")
    VIDU_API_KEY: str = _secret("VIDU_API_KEY")
    VIDU_Q3_MODEL: str = os.getenv("VIDU_Q3_MODEL", "") or "viduq3"
    VIDU_Q3_MIX_MODEL: str = os.getenv("VIDU_Q3_MIX_MODEL", "") or "viduq3-mix"
    VIDU_Q3_TURBO_MODEL: str = os.getenv("VIDU_Q3_TURBO_MODEL", "") or "viduq3-turbo"

    # Alibaba Cloud Yike workspace / OpenAPI credentials.  The workspace
    # export uses apiKey/apiHost/workspaceId; native AK/SK remains supported
    # as a fallback for the official Yike SDK.  The remaining fields are
    # connection metadata/protocol capability flags from the export and are
    # intentionally kept out of request logs.
    YIKE_CONNECTION_ID: str = _env_first("YIKE_ID", "id")
    YIKE_API_KEY: str = _secret("YIKE_API_KEY")
    YIKE_API_HOST: str = _normalize_url(_env_first("YIKE_API_HOST", "apiHost"))
    YIKE_WORKSPACE_ID: str = _env_first("YIKE_WORKSPACE_ID", "workspaceId")
    YIKE_WORKSPACE_NAME: str = _env_first("YIKE_WORKSPACE_NAME", "workspaceName")
    YIKE_DESCRIPTION: str = _env_first("YIKE_DESCRIPTION", "description")
    YIKE_OPENAI_COMPATIBLE_URL: str = _normalize_url(_env_first("YIKE_OPENAI_COMPATIBLE", "openAiCompatible"))
    YIKE_DASHSCOPE_URL: str = _normalize_url(_env_first("YIKE_DASHSCOPE_URL", "dashScope"))
    # The export contains URLs in openAiCompatible/dashScope. Presence of the
    # DashScope URL enables the async header; explicit boolean config remains
    # supported for deployments that use YIKE_DASHSCOPE=true.
    YIKE_OPENAI_COMPATIBLE: bool = bool(YIKE_OPENAI_COMPATIBLE_URL) or _env_bool("YIKE_OPENAI_COMPATIBLE")
    YIKE_DASHSCOPE: bool = bool(YIKE_DASHSCOPE_URL) or _env_bool("YIKE_DASHSCOPE", True)
    YIKE_ACCESS_KEY_ID: str = os.getenv("YIKE_ACCESS_KEY_ID", "")
    YIKE_ACCESS_KEY_SECRET: str = os.getenv("YIKE_ACCESS_KEY_SECRET", "")
    YIKE_SECURITY_TOKEN: str = os.getenv("YIKE_SECURITY_TOKEN", "")
    YIKE_REGION_ID: str = os.getenv("YIKE_REGION_ID", "cn-shanghai")
    YIKE_ENDPOINT: str = os.getenv("YIKE_ENDPOINT", "").strip()
    YIKE_SUBMIT_PATH: str = os.getenv("YIKE_SUBMIT_PATH", "/api/v1/services/aigc/video-generation/video-synthesis")
    YIKE_QUERY_PATH: str = os.getenv("YIKE_QUERY_PATH", "/api/v1/tasks/{task_id}")
    # Yike API v2026-07-07 accepts these logical model IDs.  They remain
    # configurable because a workspace may expose a dated Model Studio ID.
    YIKE_HAPPYHORSE_11_MODEL: str = os.getenv("YIKE_HAPPYHORSE_11_MODEL", "happyhorse-1.1-t2v")
    YIKE_HAPPYHORSE_10_MODEL: str = os.getenv("YIKE_HAPPYHORSE_10_MODEL", "happyhorse-1.0-t2v")
    # Wan 3.0 Video is the current Yike video model. Keep the old setting as
    # a read-only compatibility alias for tasks created before this upgrade.
    YIKE_WAN30_MODEL: str = os.getenv("YIKE_WAN30_MODEL", "wan3.0-video")
    YIKE_WAN30_PRIME_MODEL: str = os.getenv("YIKE_WAN30_PRIME_MODEL", "wan3.0-video-prime")
    YIKE_WAN27_MODEL: str = os.getenv("YIKE_WAN27_MODEL", "") or YIKE_WAN30_MODEL

    # 只允许新环境显式配置的对象存储；不提供 Supabase Auth/数据库客户端。
    SUPABASE_URL: str = os.getenv("SDVIDEO_SUPABASE_URL", "")
    SUPABASE_PUBLIC_URL: str = os.getenv("SDVIDEO_SUPABASE_PUBLIC_URL", "")
    # 文件路径保留到每次请求读取，支持令牌原子轮换；不接受旧 service_role。
    SUPABASE_STORAGE_TOKEN: str = os.getenv("SDVIDEO_SUPABASE_STORAGE_TOKEN", "")
    SUPABASE_STORAGE_TOKEN_FILE: str = os.getenv("SDVIDEO_SUPABASE_STORAGE_TOKEN_FILE", "")
    SUPABASE_API_KEY: str = os.getenv("SDVIDEO_SUPABASE_API_KEY", "")
    SUPABASE_API_KEY_FILE: str = os.getenv("SDVIDEO_SUPABASE_API_KEY_FILE", "")
    SUPABASE_CA_FILE: str = os.getenv("SDVIDEO_SUPABASE_CA_FILE", "")
    SUPABASE_INPUT_BUCKET: str = os.getenv("SDVIDEO_SUPABASE_INPUT_BUCKET", "")
    SUPABASE_RESULT_BUCKET: str = os.getenv("SDVIDEO_SUPABASE_RESULT_BUCKET", "")
    SUPABASE_THUMBNAIL_BUCKET: str = os.getenv("SDVIDEO_SUPABASE_THUMBNAIL_BUCKET", "")
    SUPABASE_VOLCANO_BUCKET: str = os.getenv("SDVIDEO_SUPABASE_VOLCANO_BUCKET", "")

    # Aliyun OSS
    OSS_KEY_ID: str = _secret("SDVIDEO_OSS_ACCESS_KEY_ID")
    OSS_ACCESSKEY: str = _secret("SDVIDEO_OSS_ACCESS_KEY_SECRET")
    OSS_SECURITY_TOKEN: str = _secret("SDVIDEO_OSS_SECURITY_TOKEN")
    OSS_BUCKET_NAME: str = os.getenv("SDVIDEO_OSS_RESULT_BUCKET", "")
    OSS_ENDPOINT: str = os.getenv("SDVIDEO_OSS_ENDPOINT", "")
    OSS_PUBLIC_ENDPOINT: str = os.getenv("SDVIDEO_OSS_PUBLIC_ENDPOINT", "")
    OSS_INPUT_BUCKET: str = os.getenv("SDVIDEO_OSS_INPUT_BUCKET", "")
    OSS_THUMBNAIL_BUCKET: str = os.getenv("SDVIDEO_OSS_THUMBNAIL_BUCKET", "")
    OSS_VOLCANO_BUCKET: str = os.getenv("SDVIDEO_OSS_VOLCANO_BUCKET", "")
    OSS_URI: str = ""

    # S3-compatible storage (AWS, MinIO or a private cloud endpoint).
    S3_ENDPOINT_URL: str = os.getenv("SDVIDEO_S3_ENDPOINT_URL", "").strip()
    S3_REGION: str = os.getenv("SDVIDEO_S3_REGION", "us-east-1").strip()
    S3_BUCKET: str = os.getenv("SDVIDEO_S3_BUCKET", "sdvideo-results").strip()
    S3_INPUT_BUCKET: str = os.getenv("SDVIDEO_S3_INPUT_BUCKET", "sdvideo-inputs").strip()
    S3_RESULT_BUCKET: str = os.getenv("SDVIDEO_S3_RESULT_BUCKET", "sdvideo-results").strip()
    S3_THUMBNAIL_BUCKET: str = os.getenv("SDVIDEO_S3_THUMBNAIL_BUCKET", "sdvideo-thumbnails").strip()
    S3_VOLCANO_BUCKET: str = os.getenv("SDVIDEO_S3_VOLCANO_BUCKET", "sdvideo-volcano-assets").strip()
    S3_ACCESS_KEY_ID: str = os.getenv("SDVIDEO_S3_ACCESS_KEY_ID", "").strip()
    S3_SECRET_ACCESS_KEY: str = os.getenv("SDVIDEO_S3_SECRET_ACCESS_KEY", "").strip()

    # AI MediaKit (字幕擦除等媒体处理)
    AMK_API_KEY: str = _secret("AMK_API_KEY")
    AMK_BASE_URL: str = os.getenv("AMK_BASE_URL", "https://mediakit.cn-beijing.volces.com")

    # 可用模型配置
    MODELS = {
        "seedance-2.5": {
            "id": SEEDANCE25_MODEL_ID,
            "name": "Seedance 2.5",
            "provider": "volcano",
            "available": LOCAL_DEMO_MODE or bool(SEEDANCE20_URL and SEEDANCE20_KEY and SEEDANCE25_MODEL_ID),
            "supports": ["text", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"],
            "ratios": ["16:9", "9:16", "1:1", "21:9", "4:3", "3:4"],
            "durations": [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
            "has_audio": True,
            "resolutions": ["480p", "720p", "1080p"],
        },
        "seedance-2.0": {
            "id": SEEDANCE20_MODEL_ID,
            "name": "Seedance 2.0",
            "provider": "volcano",
            "available": LOCAL_DEMO_MODE or (
                bool(TOKENSPACE_BASE_URL and TOKENSPACE_API_KEY and TOKENSPACE_MODEL_ID)
                if SEEDANCE20_PROVIDER == "tokenspace"
                else bool(SEEDANCE20_URL and SEEDANCE20_KEY and SEEDANCE20_MODEL_ID)
            ),
            "supports": ["text", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"],
            "ratios": ["16:9", "9:16", "1:1", "21:9", "4:3", "3:4"],
            "durations": [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            "has_audio": True,
            "resolutions": ["480p", "720p", "1080p"],
        },
        "seedance-2.0-mini": {
            "id": SEEDANCE20_MINI_MODEL_ID,
            "name": "Seedance 2.0 Mini",
            "provider": "volcano",
            "available": LOCAL_DEMO_MODE or bool(SEEDANCE20_URL and SEEDANCE20_KEY and SEEDANCE20_MINI_MODEL_ID),
            "supports": ["text", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"],
            "ratios": ["16:9", "9:16", "1:1", "21:9", "4:3", "3:4"],
            "durations": [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            "has_audio": True,
            "resolutions": ["480p", "720p"],
        },
        "seedance-fast": {
            "id": SEEDANCE_FAST_MODEL_ID,
            "name": "Seedance Fast",
            "provider": "volcano",
            "available": LOCAL_DEMO_MODE or bool(SEEDANCE20_URL and SEEDANCE20_KEY and SEEDANCE_FAST_MODEL_ID),
            "supports": ["text", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"],
            "ratios": ["16:9", "9:16", "1:1", "21:9", "4:3", "3:4"],
            "durations": [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            "has_audio": True,
            "resolutions": ["480p", "720p"],
        },
        "seedance-1.5-pro": {
            "id": "doubao-seedance-1-5-pro-251215",
            "name": "Seedance 1.5 Pro",
            "provider": "volcano",
            "available": True,
            "supports": ["text", "first_frame", "last_frame"],
            "ratios": ["16:9", "9:16", "3:2", "2:3", "1:1", "adaptive"],
            "durations": [5, 10],
            "has_audio": True,
        },
        "seedance-lite": {
            "id": "doubao-seedance-1-0-lite-i2v-250428",
            "provider": "volcano",
            "name": "Seedance Lite (参考图)",
            "available": True,
            "supports": ["text", "reference_image"],
            "ratios": ["16:9", "9:16", "1:1"],
            "durations": [5, 10],
            "has_audio": False,
        },
        "vidu-q3": {
            "id": VIDU_Q3_MODEL,
            "name": "Vidu Q3",
            "provider": "vidu",
            "available": LOCAL_DEMO_MODE or bool(VIDU_API_KEY and VIDU_Q3_MODEL),
            "supports": ["reference_image"],
            "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"],
            "durations": [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
            "has_audio": True,
            "resolutions": ["540p", "720p", "1080p"],
        },
        "vidu-q3-mix": {
            "id": VIDU_Q3_MIX_MODEL,
            "name": "Vidu Q3 Mix",
            "provider": "vidu",
            "available": LOCAL_DEMO_MODE or bool(VIDU_API_KEY and VIDU_Q3_MIX_MODEL),
            "supports": ["reference_image"],
            "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"],
            "durations": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
            "has_audio": True,
            "resolutions": ["720p", "1080p"],
        },
        "vidu-q3-turbo": {
            "id": VIDU_Q3_TURBO_MODEL,
            "name": "Vidu Q3 Turbo",
            "provider": "vidu",
            "available": LOCAL_DEMO_MODE or bool(VIDU_API_KEY and VIDU_Q3_TURBO_MODEL),
            "supports": ["text", "first_frame", "last_frame", "reference_image"],
            "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"],
            "durations": [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
            "has_audio": True,
            "resolutions": ["540p", "720p", "1080p"],
        },
        "yike-happyhorse-1.1": {
            "id": YIKE_HAPPYHORSE_11_MODEL,
            "name": "Yike HappyHorse 1.1",
            "provider": "yike",
            "available": LOCAL_DEMO_MODE or bool((YIKE_API_HOST and YIKE_API_KEY) or (YIKE_ACCESS_KEY_ID and YIKE_ACCESS_KEY_SECRET)),
            "supports": ["text", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"],
            "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"],
            "durations": list(range(4, 16)),
            "has_audio": True,
            "resolutions": ["720P", "1080P"],
        },
        "yike-happyhorse-1.0": {
            "id": YIKE_HAPPYHORSE_10_MODEL,
            "name": "Yike HappyHorse 1.0",
            "provider": "yike",
            "available": LOCAL_DEMO_MODE or bool((YIKE_API_HOST and YIKE_API_KEY) or (YIKE_ACCESS_KEY_ID and YIKE_ACCESS_KEY_SECRET)),
            "supports": ["text", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"],
            "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"],
            "durations": list(range(4, 16)),
            "has_audio": True,
            "resolutions": ["720P", "1080P"],
        },
        "yike-wan3.0-video": {
            "id": YIKE_WAN30_MODEL,
            "name": "Yike Wan 3.0 Video",
            "provider": "yike",
            "available": LOCAL_DEMO_MODE or bool((YIKE_API_HOST and YIKE_API_KEY) or (YIKE_ACCESS_KEY_ID and YIKE_ACCESS_KEY_SECRET)),
            "supports": ["text", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"],
            "ratios": ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4"],
            "durations": list(range(4, 31)),
            "has_audio": True,
            "resolutions": ["480P", "720P", "1080P"],
        },
        "yike-wan3.0-video-prime": {
            "id": YIKE_WAN30_PRIME_MODEL,
            "name": "Yike Wan 3.0 Video Prime",
            "provider": "yike",
            "available": LOCAL_DEMO_MODE or bool((YIKE_API_HOST and YIKE_API_KEY) or (YIKE_ACCESS_KEY_ID and YIKE_ACCESS_KEY_SECRET)),
            "supports": ["text", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"],
            "ratios": ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4"],
            "durations": list(range(4, 31)),
            "has_audio": True,
            "resolutions": ["480P", "720P", "1080P"],
        },
    }

    # 全局并发限制（所有账户合计，每个模型同时处理中的任务数上限，0 = 不限制）
    MODEL_CONCURRENCY_LIMITS: dict = {
        "seedance-2.5": _env_int("LIMIT_SEEDANCE_25", 30),
        "seedance-2.0": _env_int("LIMIT_SEEDANCE_20", 30),
        "seedance-2.0-mini": _env_int("LIMIT_SEEDANCE_20_MINI", 30),
        "seedance-fast": _env_int("LIMIT_SEEDANCE_FAST", 30),
        "seedance-1.5-pro": _env_int("LIMIT_SEEDANCE_15", 30),
        "seedance-lite": _env_int("LIMIT_SEEDANCE_LITE", 30),
        "vidu-q3": _env_int("LIMIT_VIDU_Q3", 30),
        "vidu-q3-mix": _env_int("LIMIT_VIDU_Q3_MIX", 30),
        "vidu-q3-turbo": _env_int("LIMIT_VIDU_Q3_TURBO", 30),
        "yike-happyhorse-1.1": _env_int("LIMIT_YIKE_HAPPYHORSE_11", 30),
        "yike-happyhorse-1.0": _env_int("LIMIT_YIKE_HAPPYHORSE_10", 30),
        "yike-wan3.0-video": _env_int("LIMIT_YIKE_WAN30_VIDEO", 30),
        "yike-wan3.0-video-prime": _env_int("LIMIT_YIKE_WAN30_VIDEO_PRIME", 30),
    }
    SEEDANCE20_MODEL_IDS: set[str] = {
        model_id
        for model_id in (SEEDANCE25_MODEL_ID, SEEDANCE20_MODEL_ID, SEEDANCE20_MINI_MODEL_ID, SEEDANCE_FAST_MODEL_ID)
        if model_id
    }
    VIDU_MODEL_IDS: set[str] = {VIDU_Q3_MODEL, VIDU_Q3_MIX_MODEL, VIDU_Q3_TURBO_MODEL}


settings = Settings()
