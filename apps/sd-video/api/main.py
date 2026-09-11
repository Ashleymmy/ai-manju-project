"""API entrypoint for the standalone SD-video service."""

import uuid
import asyncio
import sys
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.exceptions import RequestValidationError

from app.config import settings
from app.standalone_api import router as standalone_router
from app.runtime_health import dependency_health

# psycopg's async protocol requires a selector loop on Windows.  Applying the
# policy before TestClient/Uvicorn creates a loop keeps local development and
# the Linux containers on the same async code path.
if sys.platform == "win32" and hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@asynccontextmanager
async def lifespan(app: FastAPI):
    del app
    # The real provider poller is enabled only when the new deployment opts in.
    # Local development remains deterministic and does not touch any legacy API.
    yield


app = FastAPI(title="AI-Manju SD-video", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    request.state.request_id = request_id
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            too_large = int(content_length) > settings.MAX_REQUEST_BYTES
        except ValueError:
            too_large = False
        if too_large:
            return JSONResponse(
                status_code=413,
                headers={"X-Request-ID": request_id},
                content={"success": False, "data": None, "error": {"code": "payload_too_large", "message": "request is too large"}, "request_id": request_id},
            )
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Do not leak provider credentials or internal tracebacks to callers.
    logging.getLogger("sdvideo.api").error("request failed request_id=%s category=%s", getattr(request.state, "request_id", None), type(exc).__name__)
    return JSONResponse(status_code=500, content={"success": False, "data": None, "error": {"code": "internal_error", "message": "internal service error"}, "request_id": getattr(request.state, "request_id", None)})


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else "request rejected"
    code = "http_error"
    if exc.status_code == 401:
        code = "unauthorized"
    elif exc.status_code == 403:
        code = "forbidden"
    elif exc.status_code == 404:
        code = "not_found"
    elif exc.status_code == 413:
        code = "payload_too_large"
    return JSONResponse(
        status_code=exc.status_code,
        headers=exc.headers,
        content={"success": False, "data": None, "error": {"code": code, "message": detail}, "request_id": getattr(request.state, "request_id", None)},
    )


@app.exception_handler(ValueError)
async def conflict_handler(request: Request, exc: ValueError):
    is_conflict = "conflict" in str(exc)
    return JSONResponse(status_code=409 if is_conflict else 400, content={"success": False, "data": None, "error": {"code": "conflict" if is_conflict else "invalid_request", "message": "record version or id conflict" if is_conflict else "invalid request"}, "request_id": getattr(request.state, "request_id", None)})


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"success": False, "data": None, "error": {"code": "validation_error", "message": "request fields failed validation", "fields": [".".join(map(str, error["loc"])) for error in exc.errors()]}, "request_id": getattr(request.state, "request_id", None)})


# The service is private-by-default.  CORS can be explicitly enabled for local
# inspection only; browser production traffic must go through Studio Gateway.
allow_origins = [item for item in settings.FRONTEND_URLS if item] if getattr(settings, "ALLOW_CORS", False) else []
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


@app.get("/health/live", tags=["health"])
async def health_live():
    return {"status": "ok", "service": settings.SERVICE_NAME}


@app.get("/health/ready", tags=["health"])
async def health_ready():
    missing = []
    if settings.APP_ENV == "production":
        if not settings.DATABASE_URL:
            missing.append("SDVIDEO_DATABASE_URL")
        if settings.SD_VIDEO_MODE != "disabled" and not settings.SERVICE_JWT_PUBLIC_KEY:
            missing.append("SERVICE_JWT_PUBLIC_KEY")
        if settings.SD_VIDEO_MODE != "disabled" and settings.STORAGE_BACKEND == "local":
            missing.append("STORAGE_BACKEND")
        if settings.EXECUTION_MODE != "provider":
            missing.append("SD_VIDEO_EXECUTION_MODE=provider")
    payload = {"status": "ok" if not missing else "not_ready", "service": settings.SERVICE_NAME, "execution_mode": getattr(settings, "EXECUTION_MODE", "mock")}
    if missing:
        payload["missing"] = missing
        return JSONResponse(status_code=503, content=payload)
    checks = await dependency_health()
    payload["checks"] = checks
    if not all(checks.values()):
        payload["status"] = "not_ready"
        return JSONResponse(status_code=503, content=payload)
    return payload


@app.get("/metrics", tags=["health"])
async def metrics():
    from app.runtime_health import metrics_text
    return PlainTextResponse(await metrics_text(), media_type="text/plain; version=0.0.4")


app.include_router(standalone_router)
