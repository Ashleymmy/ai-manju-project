# Worker 并发、容量与队列积压运行手册

## 1. 适用范围与生产决策

本文适用于 AI-Manju 的 Go API、Redis/Celery、Python Worker 和 PostgreSQL 部署。它只固化并发、容量、连接池、观测和压测方法，不改变任务、FFmpeg 或 Provider 的业务处理流程。

生产基线：

- 单个 Worker 副本固定使用 `WORKER_CONCURRENCY=8`。
- 副本数不写死在 Compose 文件中，通过 `--scale worker=N` 控制。
- 首次上线从 `N=1` 开始；确认 Provider 429 为 0、任务错误率低于 1%、主机资源稳定后，再升到推荐目标 `N=2`（总槽位 16）。
- PostgreSQL 保持 `max_connections=100` 时，建议最多 `N=3`；不要在未调整 DB 预算前升到 `N=4`。
- 若任务以本地 FFmpeg 转码为主，必须按 CPU/内存实测决定是否升副本；`N×8` 只是槽位数，不等于主机一定能承载同数量的重转码。

## 2. 生产启动与扩容

先复制并填写生产环境变量：

```bash
cp .env.production.example .env
```

渲染并检查合并后的配置：

```bash
docker compose --env-file .env \
  -f docker-compose.yml \
  -f deploy/docker-compose.capacity.yml \
  config
```

以 1 个 Worker 副本启动：

```bash
docker compose --env-file .env \
  -f docker-compose.yml \
  -f deploy/docker-compose.capacity.yml \
  up -d --build --scale worker=1
```

通过第 6 节扩容门禁后升到 2 个副本：

```bash
docker compose --env-file .env \
  -f docker-compose.yml \
  -f deploy/docker-compose.capacity.yml \
  up -d --scale worker=2 worker
```

缩容时先确认 `queue_depth=0` 且无 running 任务，再执行同样命令并把数量改小。Worker 只使用容器内 `expose: 8101`，多副本不会争用宿主机端口。

## 3. 容量核查结论

### 3.1 Redis

2026-07-13 本地双副本运行态基线：

| 项目 | 实测值 | 生产结论 |
|---|---:|---|
| Worker 副本/总槽位 | 2 / 16 | Celery 两节点均为 concurrency 8，prefetch 8 |
| Redis 已连接客户端 | 21 | 生产 `maxclients=1000` 有充足余量 |
| 队列深度 | 0 | 基线无积压 |
| Redis 已用内存 | 1.48 MiB | 空闲基线正常 |
| `maxmemory` | 0（无限制） | 生产不可继续无限制，override 默认 1 GiB |
| 淘汰策略 | `noeviction` | 保持；禁止淘汰尚未消费的任务消息 |
| AOF | 关闭 | 生产 override 启用 `appendonly yes` + `everysec` |

连接数按当前实测约每个 Worker 副本 10 个 Redis 连接估算，`N=3` 加 API/运维连接仍远低于 1000。连接数不是 16 并发的瓶颈。

从 WP-031 起，新建的图片编辑和 multipart 视频任务不再把上传内容写成 `b64_json`。API 将文件流式写入共享资产卷，PostgreSQL payload 与 Celery 消息只保存 `storage_key`、字节数和 SHA-256 等元数据。因此新任务的 Redis 容量主要随任务条数和文本参数增长，不再随上传文件大小线性膨胀；上传文件容量改由共享资产卷承担。

2026-07-13 预览环境以 20 MiB PNG 实测：PostgreSQL payload 826 B、Redis Celery message 2,271 B，均不含 `b64_json`，相对输入分别缩小 99.9961% 和 99.9892%。两者都低于 64 KiB 验收线。

Worker 仍兼容升级前已排队的 legacy `b64_json` 消息。滚动升级期间如 Redis 中仍有旧消息，仍需按“原文件约 `1.8 倍`”的旧模型预留临时容量；旧队列排空后再按小消息模型评估。无论新旧消息都保持 `noeviction`，达到上限时让发布明确失败，禁止通过淘汰 key 静默丢任务。

### 3.2 PostgreSQL 与 API 连接池

运行态实测：PostgreSQL `max_connections=100`、`superuser_reserved_connections=3`、空闲栈总连接 8。API 原先没有显式上限；现在默认：

```env
DB_MAX_OPEN_CONNS=20
DB_MAX_IDLE_CONNS=10
DB_CONN_MAX_LIFETIME_SECONDS=1800
```

同日以 16 条并发只读连接执行 5 秒探针时，观测到总连接 24、active 连接 17、失败 0，确认当前 PostgreSQL 实例能承接目标 16 槽位的瞬时连接压力；生产上限仍按下述最坏模型和 20 条运维余量控制。

Worker 当前按操作短连接，不维护常驻池。每个并发槽位最坏同时占用：1 条 advisory lock 连接 + 1 条状态/进度更新连接；再为健康检查预留 1 条。因此容量公式为：

```text
API + N × Worker = 20 + N × (2 × 8 + 1)
```

| Worker 副本 N | 总槽位 | 估算应用连接上限 | 对 100 连接的结论 |
|---:|---:|---:|---|
| 1 | 8 | 37 | 安全 |
| 2 | 16 | 54 | 推荐生产目标 |
| 3 | 24 | 71 | 可用，但需持续观测 |
| 4 | 32 | 88 | 超过保留 20 条运维/迁移余量后的 80 条预算，不推荐 |

如果要升到 `N>=4`，必须先提高 PostgreSQL `max_connections` 或降低 API/Worker 的连接预算，并同时核查数据库内存；不能只增加 Worker。

### 3.3 Provider 限流与本地转码

Provider 配置目前没有统一保存“账号 QPS/并发额度”，因此不能仅凭本地 16 个槽位断言上游可承载 16 并发。按调用路径处理：

| 路径 | Worker 扩容影响 | 控制策略 |
|---|---|---|
| 远程图片生成/编辑 | 最坏并发为 `N×8` | 首次 N=1；已知账号速率后设置 `WORKER_PROVIDER_RATE_LIMIT` |
| Seedance/其他视频生成 API | 由 Go API 直接调用，不经过 Celery Worker | Worker 扩容不会保护或放大该路径；按 Provider 账号面板/合同单独限制入口并观察 429 |
| 本地 `video_transcode` | 不调用 Provider | 受 CPU、内存、磁盘和 FFmpeg 进程数约束 |

`WORKER_PROVIDER_RATE_LIMIT` 使用 Celery 速率格式，例如 `2/s`。它按每个 Worker 副本生效；账号总速率为 `R`、副本数为 `N` 时，每副本配置不得高于 `floor(R/N)`。不知道额度时保持为空并从一个副本开始，不要猜测额度。

当前 4xx（含 429）不会由 Worker 自动重试，可避免多副本形成重试风暴。出现任意 429 时立即停止扩容，降低 `WORKER_PROVIDER_RATE_LIMIT` 或副本数，并按上游 `Retry-After`/账号规则等待后再人工重试失败任务。

### 3.4 暂存输入目录与生命周期

新 multipart 输入位于共享资产卷：

```text
/app/data/assets/jobs/inputs/personal/<user>/<batch>/<file>
/app/data/assets/jobs/inputs/team/<workspace>/<batch>/<file>
```

API 与 Worker 必须挂载同一个 `ASSET_STORAGE_DIR`。API 生成 storage key，客户端不能指定；Worker 会校验相对路径、workspace 前缀、文件大小与 SHA-256，并拒绝绝对路径、`../`、跨 workspace 和符号链接逃逸。

生命周期规则：

- 发布失败或命中已有幂等 Job：API 删除本次请求新建的暂存文件。
- Worker 可重试失败：保留输入，保证下一次尝试仍可读取。
- 成功、最终失败或已取消：best-effort 删除声明的 `jobs/inputs/*` 文件。
- API 主动取消 queued/running Job：立即 best-effort 删除暂存输入；稍后 Worker 消费到取消消息时会再次安全清理。
- 清理失败只写结构化日志 `event=staged_input_cleanup_failed`，不得反向覆盖任务终态。

不要手工批量删除 `jobs/inputs`。必须先确认队列为空、没有 queued/running Job，并逐条核对 payload 引用；输出资产位于其它目录，不能按 `jobs` 根目录整体清理。

## 4. 观测命令

### 4.1 Worker 与队列

每个 Worker 的 `/metrics` 返回任务状态、平均耗时和 Redis 队列深度。多副本无宿主端口时，可在容器内读取：

```bash
for c in $(docker ps --filter label=com.docker.compose.service=worker --format '{{.Names}}'); do
  echo "== $c =="
  docker exec "$c" curl -fsS http://127.0.0.1:8101/metrics
  echo
done
```

检查 Celery 实际在线节点、并发和活跃任务：

```bash
docker compose exec worker celery -A worker.tasks inspect stats --timeout 5
docker compose exec worker celery -A worker.tasks inspect active --timeout 5
docker compose exec redis redis-cli LLEN "${CELERY_QUEUE_NAME:-celery}"
```

检查暂存输入占用和清理失败日志：

```bash
docker compose exec api sh -lc 'du -sh /app/data/assets/jobs/inputs 2>/dev/null || true'
docker compose logs api worker | grep 'staged_input_cleanup_failed'
```

抽查最新 Job payload 是否仍含 Base64、payload 大小和暂存 key：

```bash
docker compose exec postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select id,status,octet_length(payload::text) payload_bytes,(payload::text like '\''%b64_json%'\'') has_b64,payload->'\''staged_input_keys'\'' staged_keys from jobs order by created_at desc limit 10;"'
```

发现清理失败时先按 `job_id` 查 Job 的 `workspace_id` 与 `staged_input_keys`，再检查 API/Worker 是否共享同一资产卷、目录权限、key 前缀及文件是否被外部进程占用。路径校验失败不能通过放宽校验绕过，应修复错误引用或挂载。

### 4.2 Redis 内存与连接

```bash
docker compose exec redis redis-cli INFO clients memory stats persistence
docker compose exec redis redis-cli CONFIG GET maxmemory maxmemory-policy maxclients
```

重点字段：`connected_clients`、`rejected_connections`、`used_memory`、`maxmemory`、`evicted_keys`、`aof_enabled`。生产必须保持 `evicted_keys=0`。

### 4.3 PostgreSQL 连接

```bash
docker compose exec postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select state,count(*) from pg_stat_activity group by state order by state;"'
```

队列最老等待时间：

```bash
docker compose exec postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) queued,coalesce(extract(epoch from now()-min(created_at)),0)::int oldest_seconds from jobs where status='"'"'queued'"'"';"'
```

近 15 分钟任务错误率：

```bash
docker compose exec postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) total,count(*) filter(where status='"'"'failed'"'"') failed,round(100.0*count(*) filter(where status='"'"'failed'"'"')/nullif(count(*),0),2) failure_pct from jobs where created_at>=now()-interval '"'"'15 minutes'"'"';"'
```

## 5. 基础压测

只能在预发布或明确允许的维护窗口执行。先记录第 4 节基线，再做两层测试。

### 5.1 Redis 隔离列表探针

该探针不写真实 Celery 队列，也不会被 Worker 消费：

```bash
docker compose exec redis redis-benchmark -n 5000 -c 16 -q \
  LPUSH wp025:probe payload
docker compose exec redis redis-cli LLEN wp025:probe
docker compose exec redis redis-cli DEL wp025:probe
```

验收：`LLEN=5000`、命令错误数为 0、删除后深度为 0。2026-07-13 本机实测 5000/5000 写入成功，约 178,571 req/s，p50 0.047 ms；该数字只证明 Broker 小消息吞吐，不代表大图片或真实 Provider 吞吐。

### 5.2 真实任务阶梯压测

使用不计费的 mock Provider，依次提交 8、16、32 个任务；每档完成后再升档。记录：

1. 提交开始/结束时间。
2. `/metrics` 中 queue depth 峰值、`avg_latency_seconds`、`avg_run_seconds`。
3. PostgreSQL queued 最老等待时间和近 15 分钟错误率。
4. Redis `used_memory` 峰值、`rejected_connections`、`evicted_keys`。
5. Worker/主机 CPU、内存；若包含 FFmpeg，额外记录磁盘 IO。

真实付费 Provider 不用于盲压测。必须先取得账号并发/QPS额度，并把 `WORKER_PROVIDER_RATE_LIMIT` 设置在额度内。

### 5.3 大文件队列轻量化门禁

在预发布短暂停止 Worker，提交一个 20 MiB multipart 图片编辑任务后检查：

1. PostgreSQL `octet_length(payload::text) < 65536`，且 payload 不含 `b64_json`。
2. Redis 队列首条 Celery message 长度 `< 65536`，且查不到 `b64_json`。
3. payload 中的 storage key 对应文件大小为 20 MiB。
4. 调用 Job cancel 后文件消失；恢复 Worker 后队列归零、Job 仍为 `canceled`。

Redis 可用只返回长度和匹配位置的 Lua 抽查，避免把完整消息打印到终端：

```bash
docker compose exec redis redis-cli --raw EVAL \
  "local v=redis.call('LINDEX',KEYS[1],0); if not v then return {-1,-1} end; return {string.len(v),string.find(v,ARGV[1],1,true) or 0}" \
  1 "${CELERY_QUEUE_NAME:-celery}" b64_json
```

恢复 Worker 前必须完成取消或准备好让测试任务正常执行；验收后精确删除测试 Job，不得清空整个 Redis 或 jobs 表。

## 6. 告警阈值与扩容门禁

以当前平均运行耗时约 87 秒、生产目标 16 槽位为初始基线：

| 指标 | Warning | Critical | 动作 |
|---|---:|---:|---|
| Queue depth | 连续 5 分钟 >16 | 连续 5 分钟 >64 | 先查 429/失败与主机资源，再决定扩容 |
| 最老 queued | >175 秒 | >600 秒 | 停止继续放量，确认 Worker 在线和 Provider 状态 |
| 任务错误率（15 分钟） | >1% | >5% | 查错误码；429 时立即降速/缩容 |
| Provider 429 | 任意 1 次 | 持续出现 | 不允许扩容；按账号额度限速 |
| Redis 内存 | >70% | >85% | 限制新任务/扩容内存；保持 noeviction |
| Redis 拒绝连接/淘汰 | >0 | >0 | 立即处理，不能继续放量 |
| PostgreSQL 应用连接 | >70 | >80 | 停止扩容，检查池与慢查询 |

从 `N=1` 升到 `N=2` 必须同时满足：连续 15 分钟 429=0、错误率 <1%、Redis 内存 <70%、数据库应用连接 <70、Worker 无重启/超时、主机 CPU/内存没有持续饱和。任一条件不满足即保持或回退副本数。

## 7. 回滚

配置或容量异常时：

```bash
docker compose --env-file .env \
  -f docker-compose.yml \
  -f deploy/docker-compose.capacity.yml \
  up -d --scale worker=1 worker
```

如果是 Provider 限流，降低 `WORKER_PROVIDER_RATE_LIMIT` 和/或缩容；只有配置格式错误导致 Worker 无法启动时才临时清空该值，并应在确认账号额度后重新设置。如果是 Redis 内存不足，先停止新增任务，再扩内存并重启 Redis。不要执行 `down -v`，不要删除 PostgreSQL、Redis AOF 或资产卷。
