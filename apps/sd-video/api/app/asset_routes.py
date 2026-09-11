"""Studio 现有素材管理入口所需的只读与元数据操作。"""
import re
import uuid
import hashlib
import io
from typing import Annotated
from fastapi import Depends, HTTPException, Request, Response
from app.core.auth import ServicePrincipal, require_scope
from app.core.envelope import ok
from app.config import settings


def register_asset_routes(router):
    from app.standalone_api import volcano_store, local_storage, catalog_store, volcano_tags_store

    async def owned(principal, asset_id):
        from app.standalone_api import volcano_store
        item = await volcano_store.get(principal, asset_id)
        if item is None: raise HTTPException(status_code=404, detail="asset not found")
        return item

    @router.get("/media/{item_id}/thumbnail")
    @router.get("/volcano/assets/{item_id}/thumbnail")
    async def thumbnail(item_id: str, request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:read"))]):
        from app.thumbnail_store import build_thumbnail_store
        from app.standalone_api import local_storage
        kind = "volcano" if "/volcano/" in request.url.path else "media"
        item = await build_thumbnail_store().get(principal, kind, item_id)
        if item is None: raise HTTPException(status_code=404, detail="asset not found")
        if item.get("kind") not in {"image", "video"}: raise HTTPException(status_code=422, detail="thumbnail unsupported for this media kind")
        if not item.get("thumbnail_key"):
            code = 422 if item.get("thumbnail_error") == "unsupported_media" else 409
            raise HTTPException(status_code=code, detail="thumbnail unavailable" if code == 422 else "thumbnail pending")
        return Response(await local_storage.get(item["thumbnail_key"]), media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})

    @router.post("/volcano/register-url")
    async def register_url(request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:write"))]):
        from app.safe_download import download_result
        from app.standalone_api import input_store, register_material
        from PIL import Image
        if settings.SD_VIDEO_MODE != "active": raise HTTPException(status_code=503, detail="new registrations disabled")
        payload = await request.json()
        kind = str(payload.get("kind") or "image").lower()
        if kind not in {"image", "video"}: raise HTTPException(status_code=400, detail="invalid reference kind")
        # 每跳公网 HTTPS 校验、DNS 固定、总大小上限；不转发浏览器凭证。
        try:
            body = await download_result(str(payload.get("source_url") or ""))
        except (ValueError, OSError):
            raise HTTPException(status_code=400, detail="source requires a reachable public HTTPS media URL")
        if kind == "image":
            if len(body) > 30 * 1024 * 1024: raise HTTPException(status_code=413, detail="image too large")
            try:
                with Image.open(io.BytesIO(body)) as image:
                    content_type = Image.MIME.get(image.format, "")
                    image.verify()
                if not content_type: raise ValueError("unsupported image")
            except Exception:
                raise HTTPException(status_code=400, detail="invalid reference image")
        else:
            if b"ftyp" not in body[:32]: raise HTTPException(status_code=400, detail="reference video must be MP4")
            content_type = "video/mp4"
        token = f"inputs/{principal.workspace_id}/{principal.subject}/{uuid.uuid4().hex}-reference"
        await input_store.issue(principal, token, content_type, len(body))
        await local_storage.put(token, body, content_type)
        await input_store.complete(principal, token, len(body), hashlib.sha256(body).hexdigest())
        return ok(await register_material(principal, {**payload, "storage_token": token, "kind": kind}), request)

    @router.get("/volcano/readiness")
    async def readiness(request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:read"))]):
        from app.providers.seedance import seedance_provider_registry
        provider = seedance_provider_registry.get(settings.SEEDANCE20_PROVIDER)
        configured = settings.EXECUTION_MODE == "mock" or provider.configured()
        return ok({"provider_configured": configured, "provider_id": provider.name,
                   "provider_protocol": "tokenspace_material" if provider.name == "tokenspace" else "volcano_asset",
                   "upload_registration_available": configured and settings.SD_VIDEO_MODE == "active",
                   "public_asset_base_url_configured": settings.STORAGE_BACKEND != "local",
                   "provider_error": "" if configured else "新 SD-video 尚未配置素材 Provider 凭证"}, request)

    @router.get("/volcano/assets/{asset_id}/content")
    async def content(asset_id: str, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:read"))]):
        item = await owned(principal, asset_id)
        if item["status"] in {"delete_requested", "deleted"}: raise HTTPException(status_code=404, detail="asset deleted")
        from app.standalone_api import input_store
        source = await input_store.get(principal, item["storage_key"])
        if source is None: raise HTTPException(status_code=404, detail="input not found")
        return Response(await local_storage.get(item["storage_key"]), media_type=source["content_type"], headers={"Cache-Control": "private, no-store"})

    @router.post("/volcano/poll")
    async def poll(request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:write"))]):
        from app.standalone_api import volcano_store
        count = await volcano_store.schedule_poll(principal)
        return ok({"scheduled": count, "updated": 0, "synced": 0}, request)

    @router.put("/volcano/tags/{tag_id}")
    async def update_tag(tag_id: str, request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:write"))]):
        from app.standalone_api import catalog_store, volcano_tags_store
        payload = await request.json()
        name, color = str(payload.get("name") or "").strip(), str(payload.get("color") or "")
        if not name or len(name) > 100 or (color and not re.fullmatch(r"#[0-9a-fA-F]{6}", color)):
            raise HTTPException(status_code=400, detail="invalid tag")
        if catalog_store is not None:
            async with catalog_store._connection() as connection:
                cursor = await connection.execute("update global_tags set name=%s,color=%s where id=%s and workspace_id=%s returning id,name,color", (name, color, tag_id, principal.workspace_id))
                row = await cursor.fetchone()
                if row is None: raise HTTPException(status_code=404, detail="tag not found")
                await connection.commit()
                return ok(dict(row), request)
        for key, item in list(volcano_tags_store.items()):
            if key[0] == principal.workspace_id and item["id"] == tag_id:
                volcano_tags_store.pop(key)
                item.update(name=name, color=color)
                volcano_tags_store[(principal.workspace_id, name.casefold())] = item
                return ok(item, request)
        raise HTTPException(status_code=404, detail="tag not found")

    @router.api_route("/volcano/assets/{asset_id}/tags/{tag_id}", methods=["POST", "DELETE"])
    async def asset_tag(asset_id: str, tag_id: str, request: Request, principal: Annotated[ServicePrincipal, Depends(require_scope("assets:write"))]):
        from app.standalone_api import volcano_store, _validated_asset_tags, _asset_views
        if request.method == "POST": await _validated_asset_tags(principal, [tag_id])
        item = await volcano_store.change_tag(principal, asset_id, tag_id, request.method == "POST")
        if item is None: raise HTTPException(status_code=404, detail="asset not found")
        return ok((await _asset_views(principal, [item]))[0], request)
