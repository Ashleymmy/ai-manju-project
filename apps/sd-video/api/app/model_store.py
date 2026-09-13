"""Persistent model metadata with settings as the immutable bootstrap source."""

from __future__ import annotations

import json
from typing import Any

import psycopg
from psycopg.rows import dict_row

from app.config import settings


class ModelConfigStore:
    def __init__(self, database_url: str):
        self.database_url = database_url

    async def list(self) -> list[dict[str, Any]]:
        if not self.database_url:
            return [{"key": key, **value} for key, value in settings.MODELS.items()]
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("select id, model_id, provider, name, enabled, capabilities, config,version from model_configs order by id")
                rows = await cursor.fetchall()
                if not rows:
                    for key, value in settings.MODELS.items():
                        await cursor.execute(
                            "insert into model_configs(id,model_id,provider,name,enabled,capabilities,config) values (%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb) on conflict do nothing",
                            (key, value.get("id") or key, value.get("provider") or "", value.get("name") or key, bool(value.get("available", True)), json.dumps({"supports": value.get("supports", []), "ratios": value.get("ratios", []), "durations": value.get("durations", []), "resolutions": value.get("resolutions", []), "has_audio": value.get("has_audio", False)}), json.dumps(value)),
                        )
                    await connection.commit()
                    await cursor.execute("select id, model_id, provider, name, enabled, capabilities, config,version from model_configs order by id")
                    rows = await cursor.fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            base = dict(row.get("config") or {})
            base.update({"key": row["id"], "id": row["model_id"], "provider": row["provider"], "name": row["name"], "available": bool(row["enabled"]), "enabled": bool(row["enabled"])})
            base.update(row.get("capabilities") or {})
            base["version"] = row["version"]
            result.append(base)
        return result

    async def update(self, key: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        current = next((item for item in await self.list() if item["key"] == key), None)
        if current is None: return None
        changes = dict(changes)
        if "model_id" in changes:
            changes["id"] = changes.pop("model_id")
        if "enabled" in changes:
            changes["available"] = changes.pop("enabled")
        expected = changes.pop("version", current.get("version", 1))
        current.update(changes)
        if self.database_url:
            async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        update model_configs set model_id=%s,name=%s,enabled=%s,config=%s::jsonb,version=version+1,updated_at=now()
                        where id=%s and version=%s returning version
                        """,
                        (current.get("id") or key,current.get("name") or key,bool(current.get("available", True)),json.dumps(current),key,expected),
                    )
                    row = await cursor.fetchone()
                    if row is None: raise ValueError("model version conflict")
                    current["version"] = row["version"]
                await connection.commit()
        else:
            if expected != settings.MODELS[key].get("version", 1): raise ValueError("model version conflict")
            current["version"] = int(expected) + 1
            settings.MODELS[key].update(current)
        return {**current, "enabled": bool(current.get("available", True))}


def public_model(value: dict[str, Any]) -> dict[str, Any]:
    allowed = {"key", "id", "name", "provider", "available", "enabled", "version", "supports", "ratios", "durations", "resolutions", "has_audio", "description", "concurrency_limit"}
    result = {key: item for key, item in value.items() if key in allowed}
    result.setdefault("concurrency_limit", 1)
    result.setdefault("enabled", bool(value.get("available", True)))
    if settings.EXECUTION_MODE != "mock":
        provider = value.get("provider")
        if provider == "vidu": configured = bool(settings.VIDU_API_KEY)
        elif provider == "yike": configured = bool(settings.YIKE_API_HOST and settings.YIKE_API_KEY) or bool(settings.YIKE_ACCESS_KEY_ID and settings.YIKE_ACCESS_KEY_SECRET)
        else:
            from app.providers.seedance import seedance_provider_registry
            logical = str(value.get("key") or "")
            original_id = settings.MODELS.get(logical, {}).get("id") or value.get("id")
            configured = bool(settings.ARK_API_KEY) if original_id not in settings.SEEDANCE20_MODEL_IDS else seedance_provider_registry.configured(seedance_provider_registry.submission_provider(logical))
        if not configured:
            result.update(available=False, disabled_reason="provider_credentials_missing")
    return result


model_store = ModelConfigStore(settings.DATABASE_URL)
