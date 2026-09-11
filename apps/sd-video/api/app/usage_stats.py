"""统计只读持久事实；不同币种不相加，未知价格不伪装成零费用。"""
from collections import Counter
from decimal import Decimal


def usage_summary(rows):
    known, amounts = 0, {}
    for row in rows:
        if row.get("amount") is None or not row.get("currency"):
            continue
        currency = row["currency"]
        known += int(row.get("count", 1))
        amounts[currency] = amounts.get(currency, Decimal(0)) + Decimal(str(row["amount"]))
    total = sum(int(row.get("count", 1)) for row in rows)
    return {"completed_tasks": total, "priced_tasks": known, "unknown_price_tasks": total - known,
            "amounts": [{"currency": currency, "amount": str(amounts[currency])} for currency in sorted(amounts)]}


async def workspace_stats(principal):
    from app import standalone_api as api
    if api.catalog_store:
        async with api.catalog_store._connection() as connection:
            await connection.execute("set transaction isolation level repeatable read read only")
            cursor = await connection.execute("select model,status,count(*) count from tasks where workspace_id=%s group by model,status order by model,status", (principal.workspace_id,))
            states = [dict(row) for row in await cursor.fetchall()]
            cursor = await connection.execute("select currency,amount is not null priced,count(*) count,sum(amount) amount from usage_logs where workspace_id=%s group by currency,amount is not null", (principal.workspace_id,))
            usage = usage_summary(await cursor.fetchall())
            cursor = await connection.execute("select (select count(*) from conversations where workspace_id=%s) conversations,(select count(*) from media_library where workspace_id=%s) media", (principal.workspace_id, principal.workspace_id))
            counts = dict(await cursor.fetchone())
    else:
        records = [row for row in api.task_store._tasks.values() if row.workspace_id == principal.workspace_id]
        counter = Counter((row.model, row.status) for row in records)
        states = [{"model": model, "status": state, "count": count} for (model, state), count in sorted(counter.items())]
        usage = usage_summary([{"amount": None, "currency": None} for row in records if row.status == "succeeded"])
        counts = {"conversations": sum(row["workspace_id"] == principal.workspace_id for row in api.conversation_store.values()),
                  "media": sum(row["workspace_id"] == principal.workspace_id for row in api.media_store.values())}
    return {"tasks": sum(row["count"] for row in states), **counts, "task_states": states, "usage": usage}
