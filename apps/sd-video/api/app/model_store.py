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
                existing = {row["id"] for row in rows}
                if not rows or "seedance-2.0-ark" not in existing:
                    for key, value in settings.MODELS.items():
                        # Upgrade adds the independent official slot, preserving all
                        # existing metadata, enablement and operator deletions.
                        if rows and key != "seedance-2.0-ark":
                            continue
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
            # Provider routing is derived from the canonical logical model key,
            # so stale bootstrap JSON cannot make the admin catalog disagree
            # with task submission.
            if row["id"] in settings.SEEDANCE_MODEL_PROVIDER_OVERRIDES or row["id"] == "seedance-2.0":
                from app.providers.seedance.registry import seedance_provider_registry
                base["upstream_provider"] = seedance_provider_registry.submission_provider(row["id"])
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

    async def update_many(self, updates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Save a provider's model edits atomically, with per-model versions."""
        current = {item["key"]: item for item in await self.list()}
        keys = [item["key"] for item in updates]
        if not keys or len(keys) != len(set(keys)) or any(key not in current for key in keys):
            raise ValueError("invalid model selection")
        prepared = []
        for update in updates:
            key = update["key"]
            item = dict(current[key])
            expected = update["version"]
            if expected != item.get("version", 1):
                raise ValueError("model version conflict")
            changes = {name: value for name, value in update.items() if name not in {"key", "version"}}
            if "model_id" in changes:
                changes["id"] = changes.pop("model_id")
            if "enabled" in changes:
                changes["available"] = changes.pop("enabled")
            item.update(changes)
            item.update(enabled=bool(item.get("available", True)), version=expected + 1)
            prepared.append(item)
        if self.database_url:
            async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
                async with connection.cursor() as cursor:
                    # Stable lock order also keeps concurrent group edits from deadlocking.
                    for item in sorted(prepared, key=lambda value: value["key"]):
                        await cursor.execute(
                            "update model_configs set model_id=%s,name=%s,enabled=%s,config=%s::jsonb,version=version+1,updated_at=now() where id=%s and version=%s returning version",
                            (item.get("id") or item["key"], item.get("name") or item["key"], item["enabled"], json.dumps(item), item["key"], item["version"] - 1),
                        )
                        if await cursor.fetchone() is None:
                            # Raising rolls back every update in this connection's transaction.
                            raise ValueError("model version conflict")
        else:
            # No await between validation and mutation of the in-memory store.
            for item in prepared:
                settings.MODELS[item["key"]].update(item)
        return prepared


def public_model(value: dict[str, Any]) -> dict[str, Any]:
    allowed = {"key", "id", "name", "provider", "upstream_provider", "available", "enabled", "version", "supports", "ratios", "durations", "resolutions", "has_audio", "description", "concurrency_limit"}
    result = {key: item for key, item in value.items() if key in allowed}
    result.setdefault("concurrency_limit", 1)
    result.setdefault("enabled", bool(value.get("available", True)))
    logical = str(value.get("key") or "")
    from app.providers.seedance.registry import SEEDANCE_PROVIDER_MODELS, seedance_provider_registry
    original_id = settings.MODELS.get(logical, {}).get("id") or value.get("id")
    is_seedance = logical in SEEDANCE_PROVIDER_MODELS or original_id in settings.SEEDANCE20_MODEL_IDS
    if is_seedance:
        # The catalog may come from an older database row. Always expose the
        # same model-scoped route that task creation will persist.
        result["upstream_provider"] = seedance_provider_registry.submission_provider(logical)
    if settings.EXECUTION_MODE != "mock":
        provider = value.get("provider")
        if provider == "vidu": configured = bool(settings.VIDU_API_KEY)
        elif provider == "yike": configured = bool(settings.YIKE_API_HOST and settings.YIKE_API_KEY) or bool(settings.YIKE_ACCESS_KEY_ID and settings.YIKE_ACCESS_KEY_SECRET)
        else:
            if is_seedance:
                configured = seedance_provider_registry.configured(seedance_provider_registry.submission_provider(logical))
            else:
                configured = bool(settings.ARK_API_KEY)
        if not configured:
            result.update(available=False, disabled_reason="provider_credentials_missing")
    return result


model_store = ModelConfigStore(settings.DATABASE_URL)
