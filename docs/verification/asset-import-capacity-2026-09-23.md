# 大资产包导入容量修复

## 状态与范围

用户截图中的“资产包超过 512 MB，请分目录导出后导入”来自前端读取器。旧实现会将整个 ZIP 转为 ArrayBuffer，再同时解压全部文件，另外还有解压后 1 GiB 和 5000 个素材限制。

本次前端修复、构建、隔离浏览器验收和项目全量检查已完成；**未部署云端**。更新前端即可启用新的导入方式，无需修改 API 路由、鉴权、数据库或原素材存储。

未提交、未推送、未重启共享服务。已有暂存区中的模型计费等其他工单变更保留，不将它们作为本工单部署内容。

## 实现

- 新增基于固定版本 @zip.js/zip.js 2.17.0 的随机读取器，读取文件索引和清单，按需读取单个素材，支持普通 ZIP、Deflate、ZIP64 长偏移。
- 导入主流程不再检查 ZIP 总大小或解压总大小，不调用整包 arrayBuffer、不保留全部解压后的 File。每个文件校验 CRC 与实际长度后上传，完成后释放该文件引用。
- 素材数量从 5000 放宽至 100000；目录索引及 JSON 清单各保留 64 MiB 元数据预算，ZIP 条目上限 200000，保留原有目录/标签深度与名称约束。
- 在写出解压数据时检查实际输出不能超过声明大小，保留重复路径、路径安全、关联关系、缺少文件等校验；未引用的媒体不会无谓解压。
- 清单检查和文件读取可以取消。上传阶段沿用原有稳定幂等键、已完成项记录和重试机制；校验失败的文件不上传，其余文件可以继续，重试只读取未完成项。
- 保持公开兼容辅助函数 readAssetPackage 返回 File；资产库使用懒读取主流程 readAssetPackageContents。
- package.json 和锁文件仅新增一个依赖，保留原有 overrides，无批量依赖升级。现有画布 readZip 流程不变。

总包体积不再触发原先 512 MiB / 1 GiB 门槛。实际运行仍需磁盘、浏览器和网络资源；内存中的索引/清单随条目数增长，当前素材的数据由浏览器 Blob 管理。单个素材上传仍受服务器 MAX_ASSET_UPLOAD_BYTES、媒体存储及网络超时约束，本次不扩大这些单文件限制，也不宣称单个任意大小的素材均可上传。

## 实际验证

日志目录：D:/AImanju4.0/.tmp/asset-import-large-qa/

浏览器采用独立 3396/3397 前后端、测试账号与本地素材磁盘，没有向用户线上账户导入测试素材。合成 ZIP 内每个 PNG 附加填充字节，Store 保存，强制 ZIP64 本地头，避免用高压缩比掩盖实际包体积。

```text
34 × 20 MiB: ZIP bytes=713049473
asset-package-large-import: 34/34 成功；21.1s
asset-package-transfer: 小包导出/下载、另一账号恢复目录/空目录/标签/备注通过；4.8s
2 passed (28.6s)

34 × 34 MiB: ZIP bytes=1212171649
asset-package-large-import: 34/34 成功；15.5s
1 passed (16.9s)
```

第二组真实包大于 1 GiB，覆盖原先两道字节限制。逐条查询后端确认 34 个新资产 ID 不重复、大小完全一致、分类/标签/备注正确、子目录关联正确。测试对 Blob.arrayBuffer 安装 64 MiB 读取断言，整包读取会直接失败；浏览器无页面错误。耗时为隔离本机合成测试，不代表公网速度。

单元回归还验证 10001 个素材只建立索引、不保留全部 File；稀疏 Blob 夹具模拟超过 4 GiB 的真实 ZIP64 偏移并按小片读取；Deflate、错误 CRC、读取中取消及重新读取、文件损坏时跳过上传、继续时只重试失败项均通过。没有声称向真实服务上传了十万个素材。

```text
pnpm --filter ai-manhua-studio check    exit 0
pnpm --filter ai-manhua-studio test     exit 0
Test Files 198 passed (198)
Tests 1323 passed (1323)
pnpm --filter ai-manhua-studio build    exit 0; built in 3.45s

go build ./...                         exit 0
go vet ./...                           exit 0
go test ./...                          exit 0
ok github.com/ai-manju/api/internal/handler 16.702s
ok github.com/ai-manju/api/internal/service 11.307s

Canvas Agent                          4 passed
Director Desk                         87 files, 686 passed
Worker compileall + unittest          Ran 105 tests in 1.988s; OK (skipped=1)
git diff --check                      exit 0
```

Worker 验证在独立临时容器完成，仅为旧镜像补齐 requirements 已声明的 httpx，未改共享服务。所有隔离浏览器服务已结束。

## 复现与发布

夹具生成器：apps/studio/e2e/fixtures/generate-large-asset-package.py。

```text
python apps/studio/e2e/fixtures/generate-large-asset-package.py --output <测试目录>/large-folder.zip --file-mib 34
```

浏览器测试设置 ASSET_PACKAGE_TEST_API 为隔离 API、ASSET_PACKAGE_LARGE_FIXTURE 为生成 ZIP 的绝对路径、ASSET_PACKAGE_LARGE_FILE_MIB=34，再运行 asset-package-large-import.spec.ts。测试需要允许创建测试账号的隔离服务，不能对生产执行。

线上只需要发布本工单前端和锁文件更新，刷新到新版本后重新选择原 ZIP。当前尚无 studio.clouddo.cc 管理入口，未进行线上发布或线上导入验收。
