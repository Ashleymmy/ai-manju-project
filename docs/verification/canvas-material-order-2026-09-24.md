# 画布素材分类排序与完整序号验收（2026-09-24）

本地完成，未部署线上。保留共享工作区中其他任务的修改，未提交或重启共享服务。

## 修复行为

- 画布 @ 引用的直接前置节点、素材文件夹、收藏夹、搜索结果，以及素材插入选择器，统一按文本 → 图片 → 视频 → 音频排序。同类型保留原有顺序，文件夹层级不变。
- 服务端新增可选排序 `type_created_at_desc`，在分页前按类型排序，同类型按创建时间、ID 倒序。Memory / Gorm 同步实现，原有排序及接口信封保持不变。
- 导入或生成资源关联到节点后，同步画布最终完成重名处理的完整标题。历史资源在目录载入后修正遗漏的编号；一个资源被多个节点引用时不自动选择其中一个名字覆盖资源。
- 明确把共享资源的独立节点加入素材库时，复制为独立资产，保留该节点完整名称，避免覆盖原始资产名称。
- 节点下载、所选节点 ZIP、图片节点导出均使用完整节点标题及实际文件格式。图片导出保留不同节点对同一原文件的独立命名，不再仅按资产 ID 去重。长名称的尾部编号不会被旧的 80 字截断逻辑删掉。

## 回归覆盖

- 名称“素材苹果”和“素材苹果（1）”在节点、素材选择器、@ 文件夹及搜索列表分别显示。
- 浏览器实际下载的建议文件名为 `素材苹果（1）.png`、`素材镜头（1）.mp4`、`素材声音（1）.mp3`。
- 混合媒体接口故意乱序，浏览器核对文件夹、收藏夹、搜索结果的类型顺序。
- 单元测试核对：新增资源的最终编号同步、旧目录名称修复一次、共享资源保护、归档独立副本、相同源文件的多个 ZIP 条目、80 字以上名称保留末尾编号。
- 既有浏览器回归覆盖文本/图片/视频/音频改名、撤销、重做、素材入口、重新打开画布，以及同步失败后重试。
- PostgreSQL 使用独立临时容器，验证跨页顺序、相同时间的稳定排序及文件夹/收藏筛选，与 Memory 结果一致；容器已清理。

浏览器使用本地页面和模拟 API/媒体，不调用生成服务，不验证线上部署状态。

## 实际检查结果

日志目录：`.tmp/canvas-material-order-20260924/`。

Studio `check`：退出码 0。

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit
```

Studio `test` 最终结果：退出码 0。并行任务修改视频编辑器期间曾有 5 项断言失败，该任务更新后完整复跑通过，未修改它的实现或测试。

```text
Test Files  223 passed (223)
     Tests  1610 passed (1610)
  Duration  10.65s
```

Studio `build`：退出码 0，保留现有大包体积提示。

```text
✓ built in 6.48s
```

API `go build ./...`、`go vet ./...`：均退出码 0，无输出。`go test ./...`：退出码 0，摘录：

```text
ok  github.com/ai-manju/api/internal/handler     14.837s
ok  github.com/ai-manju/api/internal/repository   0.385s
ok  github.com/ai-manju/api/internal/router      1.532s
ok  github.com/ai-manju/api/internal/service    19.003s
```

针对真实数据库的额外验证：

```text
=== RUN   TestAssetLibraryTypeOrderBeforePaging
=== RUN   TestAssetLibraryTypeOrderBeforePaging/memory
=== RUN   TestAssetLibraryTypeOrderBeforePaging/postgres
--- PASS: TestAssetLibraryTypeOrderBeforePaging (0.10s)
    --- PASS: TestAssetLibraryTypeOrderBeforePaging/memory (0.00s)
    --- PASS: TestAssetLibraryTypeOrderBeforePaging/postgres (0.10s)
PASS
```

Canvas Agent：退出码 0。

```text
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

Director Desk：退出码 0。

```text
Test Files  87 passed (87)
     Tests  689 passed (689)
```

Worker `compileall worker`、`unittest discover -s tests`：退出码 0，在已有 Worker 镜像中挂载当前源码只读执行。网络安装 httpx 遭遇 TLS 错误后改用现有本地 httpx/httpcore/h11 依赖，未修改运行服务。

```text
Ran 118 tests in 2.061s
OK (skipped=2)
```

浏览器：原有 4 个名称同步场景通过；新增场景修正测试的节点选择与下载按钮定位后通过。

```text
ok archived image names follow rename, undo and reload across library entrances
ok archived video names follow rename, undo and reload across library entrances
ok archived audio names follow rename, undo and reload across library entrances
ok archived text names follow rename, undo and reload across library entrances
ok material menus group types and use complete numbered node names in downloads (6.5s)
1 passed (7.1s)
```

截图：`.tmp/canvas-material-order-20260924/browser/canvas-material-order-mate-265c5-red-node-names-in-downloads/ordered-numbered-folder.png`。
