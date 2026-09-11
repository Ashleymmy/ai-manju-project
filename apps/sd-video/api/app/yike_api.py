"""Alibaba Cloud Yike video generation client.

The Yike workspace credentials can expose either a DashScope-compatible HTTP
endpoint (api host/key/workspace) or native Alibaba Cloud OpenAPI credentials.
The HTTP path is preferred because it matches the workspace integration data
exported by the Yike console; the official SDK is kept as a fallback.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Optional

import httpx

from app.config import settings


YIKE = "yike"

_REFERENCE_TYPE_ALIASES = {
    "reference_image": "reference_image",
    "image": "reference_image",
    "reference_video": "reference_video",
    "video": "reference_video",
    "reference_audio": "reference_audio",
    "audio": "reference_audio",
}
_OPENAPI_MEDIA_TYPES = {
    "reference_image": "image",
    "reference_video": "video",
    "reference_audio": "audio",
}


class YikeAPIError(RuntimeError):
    def __init__(self, message: str, *, error_code: str = "", http_status: int = 0, request_id: str = "") -> None:
        super().__init__(message)
        self.error_code = error_code
        self.http_status = http_status
        self.request_id = request_id


class YikeGatewayError(YikeAPIError):
    pass


def _first(raw: Any, *keys: str) -> str:
    if not isinstance(raw, dict):
        return ""
    for key in keys:
        value = raw.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _request_id(raw: Any, headers: httpx.Headers | None = None) -> str:
    value = _first(raw, "request_id", "requestId", "RequestId", "RequestID")
    if value:
        return value
    if isinstance(raw, dict):
        value = _first(raw.get("output"), "request_id", "requestId", "RequestId")
        if value:
            return value
    if headers:
        for key in ("x-request-id", "x-dashscope-request-id", "x-oneapi-request-id"):
            if headers.get(key):
                return headers[key]
    return ""


def _status(value: str) -> str:
    return {
        "created": "queued",
        "pending": "queued",
        "queuing": "queued",
        "queued": "queued",
        "running": "running",
        "executing": "running",
        "processing": "running",
        "succeeded": "succeeded",
        "success": "succeeded",
        "finished": "succeeded",
        "completed": "succeeded",
        "failed": "failed",
        "error": "failed",
        "canceled": "cancelled",
        "cancelled": "cancelled",
    }.get((value or "").strip().lower(), "running")


def _is_wan_model(model: str | None) -> bool:
    wan_models = {
        settings.YIKE_WAN30_MODEL,
        settings.YIKE_WAN30_PRIME_MODEL,
        "wan3.0-video",
        "wan3.0-video-prime",
    }
    return bool(model and model in wan_models)


class YikeVideoAPI:
    name = YIKE

    def __init__(self) -> None:
        self.api_key = (settings.YIKE_API_KEY or "").strip()
        self.api_host = (settings.YIKE_API_HOST or "").rstrip("/")
        self.workspace_id = (settings.YIKE_WORKSPACE_ID or "").strip()
        self.access_key_id = (settings.YIKE_ACCESS_KEY_ID or "").strip()
        self.access_key_secret = (settings.YIKE_ACCESS_KEY_SECRET or "").strip()
        self.security_token = (settings.YIKE_SECURITY_TOKEN or "").strip()
        self.submit_path = settings.YIKE_SUBMIT_PATH
        self.query_path = settings.YIKE_QUERY_PATH
        self._transport = None

    def _api_host_configured(self) -> bool:
        return bool(self.api_host and self.api_key)

    @staticmethod
    def _video_url(raw: dict[str, Any]) -> str:
        output = raw.get("output") if isinstance(raw.get("output"), dict) else raw
        direct = _first(output, "video_url", "videoUrl", "url")
        if direct:
            return direct
        medias = output.get("Medias") if isinstance(output, dict) else None
        if isinstance(medias, list):
            for media in medias:
                if isinstance(media, dict):
                    url = _first(media, "OutputUrl", "output_url", "video_url", "url")
                    if url:
                        return url
        results = output.get("results") if isinstance(output, dict) else None
        if isinstance(results, list):
            for result in results:
                if isinstance(result, dict):
                    url = _first(result, "video_url", "videoUrl", "url", "OutputUrl")
                    if url:
                        return url
        return ""

    def configured(self) -> bool:
        return bool(
            self._api_host_configured()
            or (self.access_key_id and self.access_key_secret)
        )

    def _headers(self, *, async_task: bool = False) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        # 异步 Header 仅用于创建任务；查询接口携带它会被部分网关拒绝。
        if async_task and settings.YIKE_DASHSCOPE:
            headers["X-DashScope-Async"] = "enable"
        if self.workspace_id:
            headers["X-DashScope-WorkSpace"] = self.workspace_id
        return headers

    @staticmethod
    def _input(
        model: str,
        first_frame_url: str | None,
        last_frame_url: str | None,
        prompt: str | None,
        refs: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Build the public DashScope/Yike video-synthesis input contract.

        Wan 3.0 uses the workspace endpoint's lower-case ``media`` array. The
        native SDK's ``Medias``/``JobType`` fields belong to the AK/SK RPC API.
        """
        if _is_wan_model(model):
            if refs and (first_frame_url or last_frame_url):
                raise YikeAPIError(
                    "Wan 3.0 reference media cannot be combined with first/last frames",
                    error_code="ConflictingReferenceModes",
                    http_status=400,
                )

            cleaned_prompt = prompt or ""
            cleaned_prompt = re.sub(r"@图片(\d+)(?:_[^\s]*)?", r"图片\1", cleaned_prompt)
            media: list[dict[str, str]] = []
            if first_frame_url:
                media.append({"type": "first_frame", "url": first_frame_url})
            if last_frame_url:
                media.append({"type": "last_frame", "url": last_frame_url})
            image_index = 0
            for ref in refs:
                url = ref.get("url")
                ref_type = _REFERENCE_TYPE_ALIASES.get(str(ref.get("type") or "reference_image"))
                if not url or not ref_type:
                    continue
                media.append({"type": ref_type, "url": str(url)})
                if ref_type == "reference_image":
                    image_index += 1
                    if f"图片{image_index}" not in cleaned_prompt:
                        cleaned_prompt = f"{cleaned_prompt} 图片{image_index}".strip()

            result: dict[str, Any] = {"prompt": cleaned_prompt}
            if media:
                result["media"] = media
            return result

        result = {"prompt": prompt or ""}
        if first_frame_url:
            result["first_frame_url"] = first_frame_url
        if last_frame_url:
            result["last_frame_url"] = last_frame_url
        image_refs = [
            str(ref.get("url"))
            for ref in refs
            if ref.get("url") and str(ref.get("type") or "reference_image") in ("reference_image", "image")
        ]
        if image_refs:
            result["reference_urls"] = image_refs
        if not first_frame_url and not last_frame_url and image_refs:
            # I2V models use img_url for their single reference image.
            result["img_url"] = image_refs[0]
        return result

    @staticmethod
    def _job_type(first: str | None, last: str | None, refs: list[dict[str, Any]]) -> str:
        if first and last:
            return "first_last_frame"
        if first or last:
            return "image_to_video"
        reference_types = {
            _REFERENCE_TYPE_ALIASES.get(str((ref or {}).get("type") or "reference_image"))
            for ref in refs
            if (ref or {}).get("url")
        }
        reference_types.discard(None)
        if reference_types:
            if len(refs) == 1 and reference_types == {"reference_image"}:
                return "image_to_video"
            return "reference_to_video"
        return "text_to_video"

    @staticmethod
    def _openapi_medias(
        first_frame_url: str | None,
        last_frame_url: str | None,
        refs: list[dict[str, Any]],
    ) -> list[dict[str, str]]:
        medias: list[dict[str, str]] = []
        for url in (first_frame_url, last_frame_url):
            if url:
                medias.append({"Type": "image", "Url": url})
        for ref in refs:
            url = (ref or {}).get("url")
            ref_type = _REFERENCE_TYPE_ALIASES.get(str((ref or {}).get("type") or "reference_image"))
            if url and ref_type:
                medias.append({"Type": _OPENAPI_MEDIA_TYPES[ref_type], "Url": str(url)})
        return medias

    async def create_video_task(
        self,
        model: str,
        prompt: str = None,
        first_frame_url: str = None,
        last_frame_url: str = None,
        reference_inputs: Optional[list] = None,
        ratio: str = "16:9",
        duration: int = 5,
        resolution: str = None,
        **_: Any,
    ) -> dict[str, Any]:
        if not self.configured():
            raise YikeAPIError("Yike provider is not configured", error_code="ProviderNotConfigured")
        refs = list(reference_inputs or [])
        allowed_types = (
            set(_REFERENCE_TYPE_ALIASES)
            if _is_wan_model(model)
            else {"reference_image", "image"}
        )
        unsupported_refs = []
        for ref in refs:
            url = (ref or {}).get("url")
            if url:
                ref_type = str((ref or {}).get("type") or "reference_image")
                if ref_type not in allowed_types:
                    unsupported_refs.append(ref_type)
        if unsupported_refs:
            raise YikeAPIError(
                f"Yike model {model} does not support reference types: {', '.join(sorted(set(unsupported_refs)))}",
                error_code="UnsupportedReferenceType",
                http_status=400,
            )
        input_obj = self._input(model, first_frame_url, last_frame_url, prompt, refs)
        payload = {
            "model": model,
            "input": input_obj,
            "parameters": {"resolution": (resolution or "720P").upper(), "ratio": ratio, "duration": duration},
        }
        if self._api_host_configured():
            try:
                async with self._http_client(settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS) as client:
                    response = await client.post(
                        f"{self.api_host}{self.submit_path}",
                        headers=self._headers(async_task=True),
                        json=payload,
                    )
            except httpx.RequestError as exc:
                raise YikeGatewayError(f"Yike create request failed: {exc}", http_status=504) from exc
            raw = self._decode_response(response, "create")
            task_id = _first(raw.get("output"), "task_id", "taskId", "JobId") or _first(raw, "task_id", "taskId", "JobId", "id")
            if not task_id:
                raise YikeAPIError("Yike create response missing task id", request_id=_request_id(raw, response.headers))
            return {
                "id": task_id,
                "api_request_raw": {"model": model, "input": {"has_media": bool(first_frame_url or last_frame_url or refs)}, "parameters": payload["parameters"]},
                "api_response_raw": raw,
                "upstream_provider": YIKE,
                "request_id": _request_id(raw, response.headers),
            }
        medias = self._openapi_medias(first_frame_url, last_frame_url, refs)
        job_type = self._job_type(first_frame_url, last_frame_url, refs)
        return await asyncio.to_thread(self._create_with_sdk, model, prompt, medias, job_type, ratio, duration, resolution)

    def _http_client(self, timeout: float) -> httpx.AsyncClient:
        kwargs: dict[str, Any] = {"timeout": timeout}
        if self._transport is not None:
            kwargs["transport"] = self._transport
        return httpx.AsyncClient(**kwargs)

    @staticmethod
    def _decode_response(response: httpx.Response, operation: str) -> dict[str, Any]:
        try:
            raw = response.json()
        except ValueError as exc:
            raise YikeAPIError(f"Yike {operation} response was not valid JSON", http_status=response.status_code) from exc
        if response.status_code < 200 or response.status_code >= 300:
            error = raw.get("code") or raw.get("error_code") or raw.get("Code") if isinstance(raw, dict) else ""
            message = raw.get("message") or raw.get("error_message") or raw.get("Message") if isinstance(raw, dict) else response.reason_phrase
            raise YikeAPIError(f"Yike {operation} failed: {message}", error_code=str(error or "UpstreamError"), http_status=response.status_code, request_id=_request_id(raw, response.headers))
        return raw if isinstance(raw, dict) else {}

    def _sdk_client(self):
        from alibabacloud_tea_openapi.models import Config
        from alibabacloud_yike20260707.client import Client

        config = Config(
            access_key_id=self.access_key_id,
            access_key_secret=self.access_key_secret,
            security_token=self.security_token or None,
            region_id=settings.YIKE_REGION_ID,
            endpoint=settings.YIKE_ENDPOINT or None,
        )
        return Client(config)

    def _create_with_sdk(self, model: str, prompt: str, medias: list[dict[str, str]], job_type: str, ratio: str, duration: int, resolution: str | None) -> dict[str, Any]:
        from alibabacloud_yike20260707 import models
        from darabonba.runtime import RuntimeOptions

        client = self._sdk_client()
        request = models.SubmitVideoGenerationJobRequest(
            model=model,
            job_type=job_type,
            input=json.dumps({"Prompt": prompt or "", "Medias": medias}, ensure_ascii=False),
            aspect_ratio=ratio,
            duration=str(duration),
            resolution=(resolution or "720P").upper(),
            scene="general",
        )
        response = client.submit_video_generation_job_with_options(request, RuntimeOptions())
        body = response.body.to_map() if response and response.body else {}
        task_id = _first(body, "JobId", "job_id")
        if not task_id:
            raise YikeAPIError("Yike SDK response missing task id", request_id=_first(body, "RequestId", "request_id"))
        return {"id": task_id, "api_request_raw": {"model": model, "job_type": job_type}, "api_response_raw": body, "upstream_provider": YIKE, "request_id": _first(body, "RequestId", "request_id")}

    async def query_task(self, task_id: str) -> dict[str, Any]:
        if self._api_host_configured():
            try:
                async with self._http_client(settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS) as client:
                    response = await client.get(f"{self.api_host}{self.query_path.format(task_id=task_id)}", headers=self._headers())
            except httpx.RequestError as exc:
                raise YikeGatewayError(f"Yike query request failed: {exc}", http_status=504) from exc
            raw = self._decode_response(response, "query")
            output = raw.get("output") if isinstance(raw.get("output"), dict) else raw
            video_url = self._video_url(raw)
            return {"id": _first(output, "task_id", "taskId") or task_id, "status": _status(_first(output, "task_status", "taskStatus", "status", "Status")), "content": {"video_url": video_url}, "error_code": _first(output, "code", "error_code", "ErrorCode"), "error_message": _first(output, "message", "error_message", "ErrorMessage"), "request_id": _request_id(raw, response.headers)}
        return await asyncio.to_thread(self._query_with_sdk, task_id)

    def _query_with_sdk(self, task_id: str) -> dict[str, Any]:
        from alibabacloud_yike20260707 import models
        from darabonba.runtime import RuntimeOptions

        response = self._sdk_client().get_video_generation_job_with_options(models.GetVideoGenerationJobRequest(job_id=task_id), RuntimeOptions())
        body = response.body.to_map() if response and response.body else {}
        job = body.get("VideoGenerationJob") if isinstance(body, dict) else {}
        try:
            output = json.loads(job.get("Output") or "{}")
        except (TypeError, ValueError):
            output = {}
        medias = output.get("Medias") if isinstance(output, dict) else []
        video_url = (medias[0].get("OutputUrl") if medias and isinstance(medias[0], dict) else "") or ""
        return {"id": job.get("JobId") or task_id, "status": _status(job.get("Status")), "content": {"video_url": video_url}, "error_code": "" if job.get("Status") != "Failed" else "YikeJobFailed", "error_message": job.get("ErrorMessage") or "", "request_id": body.get("RequestId") or ""}

    async def cancel_task(self, task_id: str) -> dict[str, Any]:
        raise YikeAPIError("Yike does not expose a safe upstream video cancellation endpoint", error_code="CancelNotSupported", http_status=409)

    async def download_video(self, video_url: str) -> bytes:
        try:
            async with httpx.AsyncClient(timeout=settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS) as client:
                response = await client.get(video_url)
                response.raise_for_status()
                return response.content
        except httpx.RequestError as exc:
            raise YikeGatewayError(f"Yike video download failed: {exc}", http_status=504) from exc


yike_api = YikeVideoAPI()
