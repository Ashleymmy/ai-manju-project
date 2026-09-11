"""Stable response envelope shared by Studio and the standalone service."""

from typing import Any

from fastapi import Request


def ok(data: Any, request: Request | None = None) -> dict[str, Any]:
    return {"success": True, "data": data, "error": None, "request_id": _request_id(request)}


def error(code: str, message: str, request: Request | None = None, details: Any = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        payload["details"] = details
    return {"success": False, "data": None, "error": payload, "request_id": _request_id(request)}


def _request_id(request: Request | None) -> str | None:
	if request is None:
		return None
	return request.headers.get("x-request-id") or getattr(request.state, "request_id", None)
