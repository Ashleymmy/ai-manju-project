# 助理 1–4 工作区整合与推送验证

## 范围

按用户要求核对助理 1、2、3、4 当天到当前的对话与实际工作区修改。用户环境日期为 9 月 22 日，本机记录为 9 月 23 日。本记录使用本机日期。

- 助理 1：拟真人素材选择器与认证标记；画布复制、分组，以及仪表盘复制入口。
- 助理 2：拟真人素材后台注册、不阻塞画布，错误重试与过期结果隔离；小字排版与本地 Regular 字体。
- 助理 3：新增视频节点默认 Seedance Fast；多选节点后台批量注册素材。
- 助理 4：大目录 ZIP 导出改用共享持久磁盘，取消导出数量上限，逐文件暂存、重试与取消；原生下载及 HEAD/Range。
- 远端 `f39bbe9`、`5a0c604`：视频参考按时长附加计费、H3 定价补齐、图片自动规格按参考图张数计费。

本地功能先保存为 `206b420`，随后合入以上远端提交，无文本冲突。双方共同修改的画布主文件保留本地注册/下载逻辑，并保留远端定价上下文的 `edges`。

## 首轮整合实际输出

以下检查针对 `206b420` 与 `5a0c604` 的合并工作区，尚未包含助理 4 随后开始的大包导入补充。

```text
API (Go 1.23 Linux 容器，只读源码挂载)
go build ./... && go vet ./... && go test ./... -> exit 0
ok github.com/ai-manju/api/internal/handler 14.408s
ok github.com/ai-manju/api/internal/repository 0.007s
ok github.com/ai-manju/api/internal/router 1.392s
ok github.com/ai-manju/api/internal/service 6.641s
ok github.com/ai-manju/api/internal/storage 0.036s

pnpm --filter ai-manhua-studio check -> exit 0
pnpm --filter ai-manhua-studio test --maxWorkers=2 --minWorkers=1
Test Files 197 passed (197)
Tests      1317 passed (1317)
Duration   47.04s
pnpm --filter ai-manhua-studio build -> exit 0
built in 3.82s

pnpm --filter @basketikun/canvas-agent test
tests 4; pass 4; fail 0
pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests      686 passed (686)
Duration   144.61s

Worker (独立 Linux 容器，无网络，只读源码挂载)
python -m compileall worker -> exit 0
python -m unittest discover -s tests
Ran 105 tests in 2.141s
OK (skipped=1)

python -m unittest discover -s deploy/cloud/tests -p test_release_check.py
Ran 9 tests in 0.001s
OK

Playwright: 素材选择器、后台/批量注册、复制/分组/仪表盘复制、小字排版
23 passed (1.8m)
Playwright: 独立 API 上真实登录、ZIP 下载、Range 206、另一用户导入
1 passed (11.4s)

git diff --cached --check -> exit 0
```

Studio 第一次默认并行执行时发生 Node 内存不足（`Zone Allocation failed - process out of memory`），退出 134；限制为两个测试进程后全量通过，未因此修改应用代码。Worker 跳过一项需 `REDIS_TEST_URL` 的集成测试。

浏览器使用独立的 53141/53142/53143 端口；注册和项目页面使用隔离接口样本，资产包传输使用新编译 API 与临时账号。未重启共享 3100/3101 服务。日志位于忽略目录 `.tmp/push-20260923-*.log`。

大容量 ZIP64 和 PostgreSQL 专项的作者实测记录见 `asset-export-capacity-2026-09-23.md` 和 `project-copy-groups-2026-09-23.md`；本轮未重复这些专项，不把作者结果计为本轮运行结果。

## 后续整合

首轮合并保存为 `a0ecc4a`。等待期间远端新增 `8aa690c`（厂商模型 ID 映射至官方计费系列）与 `467f68e`（Gemini 与 Wan 定价入口、按兜底价补齐旧配置），已继续无冲突合入。

最新远端合入后重新执行 API 全量检查：

```text
go build ./... && go vet ./... && go test ./... -> exit 0
ok github.com/ai-manju/api/internal/handler 14.380s
ok github.com/ai-manju/api/internal/router 1.379s
ok github.com/ai-manju/api/internal/service 6.611s
```

按用户要求等待助理 4 的补充完成，最终收齐以下修改：

- 取消资产包整包 512 MiB/解压总量 1 GiB 门槛；按文件读取、校验及上传，支持 ZIP64，素材上限提高至 100000。新增固定版本 `@zip.js/zip.js@2.17.0`，锁文件仅增加该依赖。
- 导入任务独立于页面；IndexedDB 保存源包和检查点，切页继续、刷新自动接续、手动暂停保持暂停，新增全局任务入口。
- 目录和标签创建支持可选幂等键；与上传键配合，防止响应丢失后重复导入。账号隔离和跨标签页租约避免错误续传。

首次须等待源包缓存完成；浏览器关闭期间暂停，同一浏览器与站点重新打开并登录原账号后接续。清除站点数据会移除恢复文件。不是服务器脱离浏览器持续上传。

助理 4 最后一次补充于 UTC 06:17 完成后，本轮重新验证最终工作区：

```text
pnpm --filter ai-manhua-studio check -> exit 0
pnpm --filter ai-manhua-studio test --maxWorkers=2 --minWorkers=1
Test Files 198 passed (198)
Tests      1327 passed (1327)
Duration   50.25s
pnpm --filter ai-manhua-studio build -> exit 0
built in 5.30s

go build ./... && go vet ./... && go test ./... -> exit 0
ok github.com/ai-manju/api/internal/handler 14.505s
ok github.com/ai-manju/api/internal/router 1.406s
ok github.com/ai-manju/api/internal/service 6.749s

Playwright: asset-package-recovery + asset-package-transfer
7 passed (1.6m)
```

本轮七项真实 API 浏览器回归覆盖切页继续、刷新时上传/目录/标签响应丢失恢复、暂停后刷新、多标签页跟踪、账号切换、存储配额失败不写入服务器，以及原生下载/Range/另一个账号导入。API 重新编译，仍使用独立 53142/53143 服务和测试账号；浏览器临时目录设在 D 盘本轮忽略目录。

Canvas Agent、Director Desk、Worker 与发布配置自首轮检查后没有变化，沿用首轮实际结果。大包和数据库专项作者结果见 `asset-import-capacity-2026-09-23.md`、`asset-import-recovery-2026-09-23.md`：其中 1,212,171,649 字节资产包中途刷新后完成 34/34，Memory/PostgreSQL 幂等行为对照通过。专项结果未重复计为本轮执行。

此次工作范围为提交和推送代码，不包含云端部署。
