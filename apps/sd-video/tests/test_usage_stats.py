import asyncio


from app import standalone_api as api
from app.core.auth import ServicePrincipal
from app.usage_stats import usage_summary
from test_catalog_queries import catalog, catalog_database, body


def test_unknown_and_mixed_currency_costs_are_not_fabricated():
    assert usage_summary([{"amount": None}, {"amount": "1.20", "currency": "CNY"}, {"amount": "2.00", "currency": "USD"}, {"amount": "0.30", "currency": "CNY"}]) == {
        "completed_tasks": 4, "priced_tasks": 3, "unknown_price_tasks": 1,
        "amounts": [{"currency": "CNY", "amount": "1.50"}, {"currency": "USD", "amount": "2.00"}]}


def test_admin_stats_workspace_scope_and_persisted_usage(catalog):
    client, actor, database = catalog
    original = actor[0]
    actor[0] = ServicePrincipal(original.subject, original.subject + "_stats", "admin", frozenset({"admin", "*"}))
    async def seed():
        own, _ = await api.task_store.create(actor[0], {"model": "mock", "idempotency_key": "stats"})
        await api.task_store.update(own.id, status="succeeded", result_storage_key="results/test.mp4")
        await api.task_store.create(ServicePrincipal("outsider", "another", "member", frozenset()), {"model": "mock", "idempotency_key": "other"})
    asyncio.run(seed())
    stats = body(client.get("/v1/admin/stats"))
    assert stats["tasks"] == 1 and stats["usage"]["completed_tasks"] == 1
    assert stats["usage"]["priced_tasks"] == 0 and stats["usage"]["unknown_price_tasks"] == 1
    actor[0] = ServicePrincipal(original.subject, actor[0].workspace_id, "member", frozenset({"*"}))
    assert client.get("/v1/admin/stats").status_code == 403
