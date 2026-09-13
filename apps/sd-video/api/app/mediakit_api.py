"""
AI MediaKit API module - Subtitle Erase & Video Enhance
API Base: https://mediakit.cn-beijing.volces.com
"""

import httpx
from typing import Optional, List
from app.config import settings
from app.dailylogger import daily_logger

logger = daily_logger.get_logger()


class AMKAPIError(RuntimeError):
    """AI MediaKit API error"""
    def __init__(self, message: str, error_code: str = "", http_status: int = 0):
        super().__init__(message)
        self.error_code = error_code
        self.http_status = http_status


class MediaKitAPI:
    """AI MediaKit API client"""

    def __init__(self):
        self.base_url = settings.AMK_BASE_URL
        self.api_key = settings.AMK_API_KEY

    def _headers(self) -> dict:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    async def erase_subtitle_pro(
        self,
        video_url: str,
        mode: str = "Subtitle",
        output_encode_mode: str = "Quality",
        erase_ratio_location: Optional[List[dict]] = None,
        client_token: Optional[str] = None,
        callback_args: Optional[str] = None,
    ) -> dict:
        """Submit subtitle erase (Pro) task"""
        body = {
            "video_url": video_url,
            "mode": mode,
            "output_encode_mode": output_encode_mode,
        }
        if erase_ratio_location:
            body["erase_ratio_location"] = erase_ratio_location
        if client_token:
            body["client_token"] = client_token
        if callback_args:
            body["callback_args"] = callback_args

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/tools/erase-video-subtitle-pro",
                headers=self._headers(),
                json=body,
            )

        if resp.status_code != 200:
            logger.error(f"AMK erase-pro submit failed: {resp.status_code} {resp.text[:200]}")
            raise AMKAPIError(
                f"Submit failed: HTTP {resp.status_code}",
                http_status=resp.status_code,
            )

        data = resp.json()
        if not data.get("success"):
            err = data.get("error", {})
            raise AMKAPIError(
                err.get("message", "Unknown error"),
                error_code=err.get("code", ""),
                http_status=resp.status_code,
            )

        return data

    async def erase_subtitle_standard(
        self,
        video_url: str,
        client_token: Optional[str] = None,
        callback_args: Optional[str] = None,
    ) -> dict:
        """Submit subtitle erase (Standard) task"""
        body = {"video_url": video_url}
        if client_token:
            body["client_token"] = client_token
        if callback_args:
            body["callback_args"] = callback_args

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/tools/erase-video-subtitle",
                headers=self._headers(),
                json=body,
            )

        if resp.status_code != 200:
            logger.error(f"AMK erase-standard submit failed: {resp.status_code} {resp.text[:200]}")
            raise AMKAPIError(
                f"Submit failed: HTTP {resp.status_code}",
                http_status=resp.status_code,
            )

        data = resp.json()
        if not data.get("success"):
            err = data.get("error", {})
            raise AMKAPIError(
                err.get("message", "Unknown error"),
                error_code=err.get("code", ""),
                http_status=resp.status_code,
            )

        return data


    async def enhance_video(
        self,
        video_url: str,
        tool_version: str = "standard",
        scene: Optional[str] = None,
        resolution: Optional[str] = None,
        resolution_limit: Optional[int] = None,
        fps: Optional[int] = None,
        client_token: Optional[str] = None,
        callback_args: Optional[str] = None,
    ) -> dict:
        """Submit video enhance task"""
        body = {
            "video_url": video_url,
            "tool_version": tool_version,
        }
        if scene:
            body["scene"] = scene
        if resolution:
            body["resolution"] = resolution
        if resolution_limit:
            body["resolution_limit"] = resolution_limit
        if fps:
            body["fps"] = fps

        if client_token:
            body["client_token"] = client_token
        if callback_args:
            body["callback_args"] = callback_args

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/tools/enhance-video",
                headers=self._headers(),
                json=body,
            )

        if resp.status_code != 200:
            logger.error("AMK enhance-video submit failed: %s %s", resp.status_code, resp.text[:200])
            raise AMKAPIError(
                f"Submit failed: HTTP {resp.status_code}",
                http_status=resp.status_code,
            )

        data = resp.json()
        if not data.get("success"):
            err = data.get("error", {})
            raise AMKAPIError(
                err.get("message", "Unknown error"),
                error_code=err.get("code", ""),
                http_status=resp.status_code,
            )

        return data

    async def query_task(self, task_id: str) -> dict:
        """Query AMK task status"""
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{self.base_url}/api/v1/tasks/{task_id}",
                headers=self._headers(),
            )

        if resp.status_code != 200:
            logger.error(f"AMK query task failed: {resp.status_code} {resp.text[:200]}")
            raise AMKAPIError(
                f"Query failed: HTTP {resp.status_code}",
                http_status=resp.status_code,
            )

        return resp.json()


mediakit_api = MediaKitAPI()
