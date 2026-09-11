import re
from typing import Any, Optional

import httpx

from app.config import settings
from app.dailylogger import logger


class ViduAPIError(RuntimeError):
    def __init__(self, message: str, error_code: str = "", http_status: int = 0):
        super().__init__(message)
        self.error_code = error_code
        self.http_status = http_status


class ViduGatewayError(ViduAPIError):
    pass


class ViduVideoAPI:
    def __init__(self):
        self.base_url = settings.VIDU_BASE_URL
        self.api_key = (settings.VIDU_API_KEY or "").strip()

    def _headers(self) -> dict[str, str]:
        authorization = self.api_key
        if not re.match(r"^(token|bearer)\s+", authorization, flags=re.IGNORECASE):
            authorization = f"Token {authorization}"
        return {
            "Content-Type": "application/json",
            "Authorization": authorization,
        }

    def _ensure_configured(self) -> None:
        if not self.base_url or not self.api_key:
            raise RuntimeError("Vidu 配置缺失：请检查 VIDU_BASE_URL 与 VIDU_API_KEY")

    @staticmethod
    def _safe_payload_for_log(payload: dict[str, Any]) -> dict[str, Any]:
        safe = dict(payload)
        if "images" in safe:
            images = safe.get("images") or []
            safe["images"] = {"count": len(images), "kind": "signed_or_external"}
        if "subjects" in safe:
            safe["subjects"] = [
                {
                    "name": item.get("name"),
                    "images_count": len(item.get("images") or []),
                }
                for item in safe.get("subjects") or []
            ]
        if "prompt" in safe and safe["prompt"]:
            safe["prompt"] = str(safe["prompt"])[:200]
        return safe

    @staticmethod
    def _extract_error(response: httpx.Response) -> tuple[str, str]:
        try:
            body = response.json()
        except Exception:
            return "", response.text[:1000]
        code = str(body.get("reason") or body.get("code") or body.get("err_code") or "")
        message = str(body.get("message") or body.get("error") or body)
        return code, message

    @staticmethod
    def _friendly_http_error(action: str, response: httpx.Response, message: str) -> str:
        status = response.status_code
        if status == 401:
            return (
                f"Vidu {action}失败：Vidu 官方返回 401 Unauthorized。"
                "请检查 .env 里的 VIDU_API_KEY 是否有效，并确认 VIDU_BASE_URL 使用了该 key 对应的网关"
                "（国内平台通常是 https://api.vidu.cn，国际平台通常是 https://api.vidu.com），"
                "更新后重启 Docker 再试。"
            )
        if status == 403:
            return f"Vidu {action}失败：当前 key 无权限或账号不可用，Vidu 官方返回 403。"
        return f"Vidu {action}失败：status={status}，error={message}"

    @staticmethod
    def _normalize_state(state: str) -> str:
        mapping = {
            "created": "queued",
            "queueing": "queued",
            "scheduled": "queued",
            "processing": "running",
            "success": "succeeded",
            "succeeded": "succeeded",
            "failed": "failed",
            "cancelled": "cancelled",
            "canceled": "cancelled",
        }
        return mapping.get((state or "").lower(), "running")

    @staticmethod
    def _subject_prompt(prompt: str, count: int) -> str:
        cleaned = prompt or ""
        for idx in range(1, count + 1):
            cleaned = re.sub(rf"@?图片{idx}(?:_[^\s]*)?", f"@subject{idx}", cleaned)
        for idx in range(1, count + 1):
            if f"@subject{idx}" not in cleaned:
                cleaned = f"{cleaned} @subject{idx}".strip()
        return cleaned

    async def create_video_task(
        self,
        model: str,
        prompt: str = None,
        first_frame_url: str = None,
        last_frame_url: str = None,
        reference_inputs: Optional[list] = None,
        ratio: str = "16:9",
        duration: int = 5,
        generate_audio: bool = True,
        resolution: str = None,
        seed: int = None,
        movement_amplitude: str = "auto",
        off_peak: bool = False,
    ) -> dict[str, Any]:
        self._ensure_configured()

        reference_inputs = reference_inputs or []
        image_refs = [r.get("url") for r in reference_inputs if r.get("type") == "reference_image" and r.get("url")]
        unsupported_refs = [r.get("type") for r in reference_inputs if r.get("type") not in (None, "reference_image")]
        if unsupported_refs:
            raise ViduAPIError(
                "Vidu 当前接入仅支持图片参考；视频/音频参考请使用 Seedance 2.0。",
                error_code="UnsupportedReferenceType",
                http_status=400,
            )

        endpoint = "/ent/v2/text2video"
        payload: dict[str, Any] = {
            "model": model,
            "prompt": prompt or "",
            "duration": duration,
            "resolution": resolution or "720p",
            "seed": seed,
            "movement_amplitude": movement_amplitude,
            "off_peak": off_peak,
        }

        if first_frame_url and last_frame_url:
            endpoint = "/ent/v2/start-end2video"
            payload["images"] = [first_frame_url, last_frame_url]
        elif image_refs:
            endpoint = "/ent/v2/reference2video"
            if model == settings.VIDU_Q3_MIX_MODEL:
                payload["images"] = image_refs[:7]
            else:
                payload["subjects"] = [
                    {"name": f"subject{idx}", "images": [url]}
                    for idx, url in enumerate(image_refs[:7], start=1)
                ]
                payload["prompt"] = self._subject_prompt(prompt or "", len(payload["subjects"]))
            payload["audio"] = bool(generate_audio)
            payload["aspect_ratio"] = ratio
        elif first_frame_url:
            endpoint = "/ent/v2/img2video"
            payload["images"] = [first_frame_url]
            payload["audio"] = bool(generate_audio)
        else:
            endpoint = "/ent/v2/text2video"
            payload["style"] = "general"
            payload["aspect_ratio"] = ratio
            payload["audio"] = bool(generate_audio)

        if payload.get("seed") is None:
            payload.pop("seed", None)

        logger.info("[Vidu API] 创建任务 | endpoint=%s | model=%s | duration=%s", endpoint, model, duration)
        async with httpx.AsyncClient(timeout=settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS) as client:
            try:
                response = await client.post(f"{self.base_url}{endpoint}", headers=self._headers(), json=payload)
                response.raise_for_status()
                result = response.json()
                task_id = result.get("task_id") or result.get("id")
                return {"id": task_id, "api_request_raw": payload, "api_response_raw": result, "provider": "vidu"}
            except httpx.HTTPStatusError as e:
                code, message = self._extract_error(e.response)
                safe_payload = self._safe_payload_for_log(payload)
                log_message = (
                    f"创建 Vidu 任务失败 | status={e.response.status_code} "
                    f"| url={e.request.url} | error={message} | payload={safe_payload}"
                )
                logger.error(log_message)
                raise ViduAPIError(
                    self._friendly_http_error("创建任务", e.response, message),
                    error_code=code,
                    http_status=e.response.status_code,
                ) from e
            except (httpx.TimeoutException, httpx.ConnectError) as e:
                raise ViduGatewayError(f"Vidu API 连接超时/异常: {str(e)}", http_status=504) from e

    async def query_task(self, task_id: str) -> dict[str, Any]:
        self._ensure_configured()
        async with httpx.AsyncClient(timeout=settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS) as client:
            try:
                response = await client.get(f"{self.base_url}/ent/v2/tasks/{task_id}/creations", headers=self._headers())
                response.raise_for_status()
                result = response.json()
            except httpx.HTTPStatusError as e:
                code, message = self._extract_error(e.response)
                raise ViduAPIError(
                    self._friendly_http_error("查询任务", e.response, message),
                    error_code=code,
                    http_status=e.response.status_code,
                ) from e
            except (httpx.TimeoutException, httpx.ConnectError) as e:
                raise ViduGatewayError(f"Vidu API 连接超时/异常: {str(e)}", http_status=504) from e

        state = result.get("state") or result.get("status") or ""
        status = self._normalize_state(state)
        video_url = ""
        creations = result.get("creations") or []
        if creations:
            video_url = creations[0].get("url") or creations[0].get("watermarked_url") or ""

        error_message = result.get("err_code") or result.get("message") or ""
        return {
            "status": status,
            "content": {"video_url": video_url},
            "error": {"message": error_message},
            "api_response_raw": result,
        }

    async def cancel_task(self, task_id: str) -> dict[str, Any]:
        self._ensure_configured()
        async with httpx.AsyncClient(timeout=settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS) as client:
            try:
                response = await client.post(
                    f"{self.base_url}/ent/v2/tasks/{task_id}/cancel",
                    headers=self._headers(),
                    json={"id": task_id},
                )
                response.raise_for_status()
                return response.json() if response.text.strip() else {"success": True}
            except httpx.HTTPStatusError as e:
                code, message = self._extract_error(e.response)
                raise ViduAPIError(
                    self._friendly_http_error("取消任务", e.response, message),
                    error_code=code,
                    http_status=e.response.status_code,
                ) from e

    async def download_video(self, video_url: str) -> bytes:
        async with httpx.AsyncClient(timeout=settings.MODEL_RETURN_WAIT_TIMEOUT_SECONDS) as client:
            response = await client.get(video_url)
            response.raise_for_status()
            return response.content


vidu_api = ViduVideoAPI()
