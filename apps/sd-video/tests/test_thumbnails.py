import asyncio
import io

import psycopg
import pytest
from PIL import Image

from app import standalone_api as api
from app.core.auth import ServicePrincipal
from app.mock_media import MOCK_VIDEO
from app.storage.adapter import LocalStorageAdapter
from app.thumbnail_store import ThumbnailStore
from worker.thumbnails import render_thumbnail, process_thumbnail, UnsupportedMedia
from test_catalog_queries import catalog, catalog_database, seed_media, body


def png():
    output = io.BytesIO()
    Image.new("RGB", (1280, 720), "red").save(output, "PNG")
    return output.getvalue()


@pytest.mark.parametrize("kind,source", [("image", png()), ("video", MOCK_VIDEO)])
def test_real_thumbnail_decoder(kind, source):
    output = render_thumbnail(source, kind)
    with Image.open(io.BytesIO(output)) as image:
        assert image.format == "JPEG" and 0 < image.width <= 640 and 0 < image.height <= 360


def test_invalid_video_does_not_become_successful_preview():
    with pytest.raises(UnsupportedMedia): render_thumbnail(b"not-an-mp4", "video")


@pytest.fixture
def preview(catalog, monkeypatch, tmp_path):
    client, actor, database = catalog
    row = seed_media(catalog, 1)[0]
    storage = LocalStorageAdapter(str(tmp_path))
    asyncio.run(storage.put(row["storage_key"], MOCK_VIDEO, "video/mp4"))
    monkeypatch.setattr(api, "local_storage", storage)
    store = ThumbnailStore(database or "", {"media": api.media_store})
    monkeypatch.setattr("app.thumbnail_store.build_thumbnail_store", lambda: store)
    if database:
        with psycopg.connect(database) as connection:
            connection.execute("update media_library set thumbnail_next_attempt=to_timestamp(0) where id=%s", [row["id"]])
    return client, actor, database, store, storage, row


def test_thumbnail_lease_scope_and_restart_recovery(preview):
    client, actor, database, store, storage, row = preview
    path = f"/v1/media/{row['id']}/thumbnail"
    assert client.get(path).status_code == 409
    claimed = asyncio.run(store.claim("media"))
    assert claimed["id"] == row["id"]
    # 过期持有者写入被拒绝；新实例认领同一持久记录。
    if database:
        with psycopg.connect(database) as connection:
            connection.execute("update media_library set thumbnail_lease_until=to_timestamp(0) where id=%s", [row["id"]])
        recovered = ThumbnailStore(database)
    else:
        api.media_store[row["id"]]["thumbnail_lease_until"] = 0
        recovered = store
    assert not asyncio.run(store.finish("media", claimed, key="thumbnails/stale"))
    current = asyncio.run(recovered.claim("media"))
    assert current["id"] == claimed["id"] and current["thumbnail_lease_owner"] != claimed["thumbnail_lease_owner"]
    asyncio.run(process_thumbnail(recovered, storage, "media", current))
    response = client.get(path)
    assert response.status_code == 200 and response.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(response.content)) as image: assert image.format == "JPEG"
    original = actor[0]
    actor[0] = ServicePrincipal("intruder", original.workspace_id, "member", original.scopes)
    assert client.get(path).status_code == 404
    actor[0] = original
    body(client.delete(f"/v1/media/{row['id']}"))
    assert client.get(path).status_code == 404


def test_thumbnail_transient_storage_failure_is_retryable(preview):
    _, actor, _, store, storage, _ = preview
    item = asyncio.run(store.claim("media"))
    class BrokenStorage:
        async def get(self, key): raise OSError("synthetic unavailable")
    asyncio.run(process_thumbnail(store, BrokenStorage(), "media", item))
    saved = asyncio.run(store.get(actor[0], "media", item["id"]))
    assert saved["thumbnail_error"] == "thumbnail_retry_pending" and not saved.get("thumbnail_key")


def test_delete_during_thumbnail_generation_does_not_resurrect(preview):
    client, actor, _, store, storage, row = preview
    item = asyncio.run(store.claim("media"))
    body(client.delete(f"/v1/media/{row['id']}"))
    asyncio.run(process_thumbnail(store, storage, "media", item))
    assert asyncio.run(store.get(actor[0], "media", row["id"])) is None
    assert not list(storage.root.rglob("*.jpg"))
