"""列表查询契约：数据库和离线仓储使用相同的分页、筛选与统计规则。"""
from dataclasses import dataclass
from datetime import datetime
from typing import Mapping

# 列表上限与旧 HTTP 契约一致；mention 保持最多 20 条，避免建议框加载全库。
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
MENTION_PAGE_SIZE = 20
MAX_QUERY_LENGTH = 200
MAX_SQL_OFFSET = 2**63 - 1  # PostgreSQL OFFSET 使用有符号 bigint。


@dataclass(frozen=True)
class Page:
    number: int = 1
    size: int = DEFAULT_PAGE_SIZE
    start: int | None = None

    @classmethod
    def read(cls, params: Mapping[str, str], *, maximum: int = MAX_PAGE_SIZE, default: int = DEFAULT_PAGE_SIZE):
        number = max(1, int(params.get("page", "1")))
        size = min(maximum, max(1, int(params.get("pageSize", str(default)))))
        if (number - 1) * size > MAX_SQL_OFFSET:
            raise ValueError("page exceeds supported offset")
        return cls(number, size)

    @property
    def offset(self):
        return self.start if self.start is not None else (self.number - 1) * self.size

    @classmethod
    def assets(cls, params):
        # 旧管理页面使用任意 limit/offset；不能四舍五入到 page 后漏掉记录。
        if "limit" not in params and "offset" not in params:
            return cls.read(params)
        size = min(MAX_PAGE_SIZE, max(1, int(params.get("limit", str(DEFAULT_PAGE_SIZE)))))
        start = max(0, int(params.get("offset", "0")))
        if start > MAX_SQL_OFFSET:
            raise ValueError("offset exceeds supported range")
        return cls(start // size + 1, size, start)

    def result(self, items, total):
        result = {"items": items, "total": int(total), "page": self.number, "pageSize": self.size}
        if self.start is not None:
            result.update(limit=self.size, offset=self.start)
        return result

    def slice(self, items):
        return self.result(items[self.offset:self.offset + self.size], len(items))


def keyword(params):
    value = params.get("keyword", "").strip()
    if len(value) > MAX_QUERY_LENGTH:
        raise ValueError("keyword is too long")
    return value.lower()


def record_order(item, field="created_at"):
    value = item.get(field, item.get("created_at", 0))
    return (value.timestamp() if isinstance(value, datetime) else float(value or 0), item["id"])


@dataclass(frozen=True)
class MediaFilter:
    keyword: str = ""
    kind: str = ""
    tag: str = ""
    category: str = ""

    @classmethod
    def read(cls, params):
        kind = params.get("kind", "").strip().lower()
        if kind == "all":
            kind = ""
        if kind not in {"", "image", "video", "audio"}:
            raise ValueError("invalid media kind")
        tag, category = params.get("tag", "").strip(), params.get("category", "").strip()
        if max(len(tag), len(category)) > MAX_QUERY_LENGTH:
            raise ValueError("media filter is too long")
        return cls(keyword(params), kind, tag, category)

    def matches(self, item):
        metadata = item.get("metadata") or {}
        if not isinstance(metadata, dict):
            metadata = {}
        tags = metadata.get("tags")
        prompt = metadata.get("prompt")
        prompt = prompt.lower() if isinstance(prompt, str) else ""
        return (not self.kind or item.get("kind") == self.kind) and (
            not self.keyword or self.keyword in str(item.get("name") or "").lower()
            or self.keyword in prompt) and (
            not self.category or metadata.get("category") == self.category) and (
            not self.tag or isinstance(tags, list) and self.tag in tags)

    def sql(self):
        # SQL 结构只来自固定字段；用户输入全部作为参数，%/_ 也按字面搜索。
        conditions, parameters = [], []
        if self.keyword:
            conditions.append("(strpos(lower(name),%s)>0 or (jsonb_typeof(metadata->'prompt')='string' and strpos(lower(metadata->>'prompt'),%s)>0))")
            parameters += [self.keyword, self.keyword]
        if self.kind:
            conditions.append("kind=%s")
            parameters.append(self.kind)
        if self.tag:
            conditions.append("(jsonb_typeof(metadata->'tags')='array' and (metadata->'tags') @> jsonb_build_array(%s::text))")
            parameters.append(self.tag)
        if self.category:
            conditions.append("(jsonb_typeof(metadata->'category')='string' and metadata->>'category'=%s)")
            parameters.append(self.category)
        return "".join(" and " + condition for condition in conditions), parameters


def media_stats(items):
    return {"total": len(items), "images": sum(item.get("kind") == "image" for item in items),
            "videos": sum(item.get("kind") == "video" for item in items),
            "audio": sum(item.get("kind") == "audio" for item in items),
            "size_bytes": sum(int(item.get("size_bytes") or 0) for item in items)}


@dataclass(frozen=True)
class VolcanoFilter:
    keyword: str = ""
    kind: str = ""
    tag: str = ""
    statuses: tuple[str, ...] = ()

    @classmethod
    def read(cls, params):
        media = MediaFilter.read(params)
        state = params.get("status", "").strip().lower()
        # Processing 是旧 UI 的聚合状态；内部 processing 可精确筛选。
        states = ("queued", "processing", "delete_requested") if state == "pending" else (state,) if state else ()
        if not set(states) <= {"queued", "processing", "active", "failed", "delete_requested"}:
            raise ValueError("invalid asset status")
        return cls(media.keyword, media.kind, media.tag, states)

    def matches(self, item):
        return (item["status"] != "deleted" and (not self.statuses or item["status"] in self.statuses)
                and (not self.keyword or self.keyword in str(item.get("name") or "").lower())
                and (not self.kind or item.get("kind") == self.kind)
                and (not self.tag or self.tag in item.get("tags", [])))

    def sql(self):
        conditions, values = ["status<>'deleted'"], []
        if self.keyword:
            conditions.append("strpos(lower(name),%s)>0")
            values.append(self.keyword)
        if self.kind:
            conditions.append("kind=%s")
            values.append(self.kind)
        if self.tag:
            conditions.append("tags @> jsonb_build_array(%s::text)")
            values.append(self.tag)
        if self.statuses:
            conditions.append("status=any(%s)")
            values.append(list(self.statuses))
        return "".join(" and " + condition for condition in conditions), values


async def select_page(connection, page, *, columns, source, parameters, order):
    # 同一请求的 count 与 items 使用同一快照，避免并发写入使总数和当前页不一致。
    await connection.execute("set transaction isolation level repeatable read read only")
    cursor = await connection.execute("select count(*) total " + source, parameters)
    total = (await cursor.fetchone())["total"]
    cursor = await connection.execute("select " + columns + " " + source + " order by " + order + " limit %s offset %s",
                                      [*parameters, page.size, page.offset])
    return page.result([dict(row) for row in await cursor.fetchall()], total)
