# 资产目录大批量导出修复与验证

## 状态

代码、部署模板和隔离验证已完成，**尚未部署到 studio.clouddo.cc**，当前缺少云端管理入口。未重启 3100/3101 共享服务，未修改原素材存储，未提交或推送。其他助理的在途修改保留。

本报告取代前一版“仅增加临时空间、调整上传限制”的修复方案。

## 根因

用户提供的真实云端任务 asset_export_70c76eb55084a79751a37a6d：total=34、succeeded=34、failed=0，但最终 status=failed，error.message 为 Storage request failed (HTTP 413)。历史 56 个素材同因失败。

原素材处理完成后，最终 ZIP 上传到素材存储被体积限制拒绝。现有证据不能确定 413 来自 Storage、桶级限制还是入口代理，不能推断具体阈值。另有三个瓶颈：导出选择最多 5000 个、云端 /tmp 是 256 MiB tmpfs、浏览器下载先创建整包 Blob。旧配置曾用 35 × 8 MiB 测试复现 no space left on device。

## 最终实现

- API 与导出 Worker 共享专用持久磁盘：ASSET_EXPORT_STORAGE_DIR=/app/export-archives，挂载 studio-export-archives。完整 ZIP 不再上传素材存储，避开原来的整包上传限制；原素材仍从原存储读取。
- ZIP 和单个素材暂存都写入该磁盘，文件同步后原子改名发布，无第二份整包复制。每次尝试使用不同文件名，新存储键以 local-exports/ 开头；旧 ZIP 继续从原存储读取、到期删除。
- 移除导出 5000 个上限；Memory/Gorm 使用内部完整筛选快照，公开列表分页不变。资产、标签、使用记录按 500 个分批查询/记录，避免整目录参数过多。
- 每次只暂存一个源文件，有界缓冲复制；临时读取失败最多尝试三次，读取完整后才写 ZIP。永久失败的素材列入失败清单，不写入残缺条目。
- 每 100 个素材或 2 秒更新进度；取消能关闭阻塞读取。数据库完成事务的回包丢失时，不误删可能已发布的 ZIP。
- 保留 7 天到期清理；只清理超过 24 小时的遗留 .pending 文件。
- 资产库与画布 ZIP 使用浏览器原生下载；HEAD 检查登录及就绪状态，不创建整包 Blob，不将登录凭证放入 URL。同一内容路由支持 HEAD、Range/206/416，鉴权和响应信封不变。
- 页面显示失败原因；部署检查拒绝 API/Worker 不共用可写磁盘、只读卷或 tmpfs。

容量仍取决于磁盘、网络、保留任务数及并发。内容缓冲不随 ZIP 大小增长，但条目、路径和清单元数据仍随素材数增长。峰值磁盘须覆盖保留 ZIP、本次 ZIP、当前最大单素材暂存及并发任务。

本次范围是导出下载。浏览器资产包导入仍保留原有 5000 个保护上限；大包可使用支持 ZIP64 的解压工具，这不影响打包下载。

## 大容量实际输出

日志目录：D:/AImanju4.0/.tmp/asset-export-large-qa/

Linux 隔离容器设定 1 GiB 内存上限、只读根目录、256 MiB /tmp，并另挂磁盘卷。素材是按需生成的字节流，ZIP 使用 Store，不用压缩比掩盖体积；模拟素材存储拒绝所有上传并返回 413。

```text
=== RUN   TestAssetExportLargeDiskArchive/10001_assets_625MiB
10001 media CRC-verified, bytes=657259037, media-store uploads=0, separate API read/expiry/isolation passed
=== RUN   TestAssetExportLargeDiskArchive/ZIP64_65536_assets
65536 media CRC-verified, bytes=12057872, media-store uploads=0, separate API read/expiry/isolation passed
=== RUN   TestAssetExportLargeDiskArchive/ZIP64_file_over_4GiB
1 media CRC-verified, bytes=4294969066, media-store uploads=0, separate API read/expiry/isolation passed
--- PASS: TestAssetExportLargeDiskArchive (16.24s)
PASS
```

所有 ZIP 条目读到 EOF 校验 CRC、数量和大小；另一个 API 实例从相同磁盘读取，并验证跨账号拒绝、到期删除、暂存清理。覆盖 ZIP64 的条目数和单文件大小边界。测试耗时不代表真实公网传输速度。

PostgreSQL 15 专用容器不发布端口，不使用生产数据。文件夹含子目录、筛选、显式选中三种方式各创建 10,001 条完整任务，公开分页仍为 30。

```text
=== RUN   TestAssetExportUnboundedSelectionPostgres
--- PASS: TestAssetExportUnboundedSelectionPostgres (1.88s)
=== RUN   TestAssetPackageGormPostgres
--- PASS: TestAssetPackageGormPostgres (0.20s)
PASS
```

## 全量及浏览器验证

```text
go build ./...                         exit 0
go vet ./...                           exit 0
go test ./...                          exit 0
ok github.com/ai-manju/api/internal/handler 17.713s
ok github.com/ai-manju/api/internal/service 11.600s
ok github.com/ai-manju/api/internal/storage 0.749s

pnpm --filter ai-manhua-studio check    exit 0
pnpm --filter ai-manhua-studio test     exit 0
Test Files 196 passed (196)
Tests 1308 passed (1308)
pnpm --filter ai-manhua-studio build    exit 0; built in 3.38s

Canvas Agent                          4 passed
Director Desk                         87 files, 686 passed
Worker compileall + unittest          Ran 105 tests in 2.005s; OK (skipped=1)
deploy/cloud release-check unittest   Ran 9 tests; OK
Compose base + storage token overlay   shared writable export volume; original readonly mounts retained
git diff --check (本工单文件)            exit 0
Playwright asset-package-transfer     1 passed (10.6s)
```

Go 回归覆盖中断重试、永久失败无残缺条目、阻塞读取取消、HEAD/Range/416、账号隔离和数据库发布回包丢失不丢包。重负载 ZIP64 测试通过 ASSET_EXPORT_CAPACITY_TEST=1 显式启用。

浏览器在独立 3296/3297 服务真实登录，用 Cookie 原生下载并落盘，再通过同 URL 的 Range 读取 64 字节。另一账号导入小型目录样本，核对子目录、空目录、标签、备注，页面无运行错误。首次测试因等待 Chrome 不发出的下载 request 事件超时；调整为检查原生 download URL、落盘和 Range 后通过，应用无需为此修改。

Worker 使用独立临时容器，只读挂载源码；旧测试镜像缺少 requirements 已声明的 httpx，仅在临时容器安装后完成检查，未改共享 Worker。

## 上线与验收（未执行）

1. 获取 studio.clouddo.cc 管理入口及现行发布参数，构建发布包含本修复的 API/导出 Worker 和前端镜像。不要把其他未确认的在途修改一并部署。
2. API 与全部导出 Worker 必须访问同一持久磁盘。单机 Compose 已配置；跨主机须使用真实共享文件系统，不能用各主机互相隔离的同名 Docker 本地卷。按保留总量与并发预留并监控空间。
3. 运行发布配置检查，保留密钥、CA、Storage Token 挂载，定向更新 API、asset-export-worker、web。本方案无需调高原素材存储上传上限。
4. 验证 Worker 就绪探针、API 磁盘读取和实际入口代理。仓库 web/edge 配置已关闭响应缓冲并保留长连接下载超时。
5. 重新导出原失败的 34 个素材目录，旧失败任务不会自动变为成功。再验真实数千素材、超过 256 MiB 的 ZIP、全量 CRC、清单、原生下载和 206 Range；不可读取的素材必须如实显示部分失败。
6. 回滚时保留归档卷。旧 API 不认识新 local-exports/ 包，应保留新版本读取能力或等现有包过期，不能删除卷来回滚。

尚未获得服务器管理入口，因此线上故障尚不能认定解除。已询问入口及用户名，不需要发送密码。
