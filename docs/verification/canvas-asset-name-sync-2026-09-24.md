# 节点素材名称同步与关联流程检查（2026-09-24）

## 本轮范围

检查画布改名、素材入库、资产选择器、@ 引用、撤销/重做、保存刷新，以及改名后的下载/导出。追加检查画布图片和视频工具的可用状态。此报告说明本轮实际检查的流程，不代表对全项目每个功能做了穷尽验收。

## 确认并修复的问题

| 原问题 | 修复后的行为 |
| --- | --- |
| 节点改名只更新画布 | 图片、视频、音频的关联素材名称通过现有 metadata 接口实际保存 |
| 重名重排、撤销/重做未更新素材 | 观察实际节点标题事务，关联素材跟随最终标题；选择节点、移动节点和加载画布不产生改名请求 |
| 手动收藏的文本后续名称被冻结 | 名称单独更新，保留已保存的正文、分类、文件夹和 ID |
| 手动保存文本用提示词作为名称 | 使用节点名称，避免标题和提示词混用 |
| 已有媒体再次入库只改分类，新上传名称带文件扩展名 | 入库时同步名称；显示名称和上传文件名分开保存 |
| @ 弹窗、资产选择器沿用旧缓存 | 接收现有跨窗口名称通知，更新实际列表；较早开始的列表请求不能覆盖已确认的新名 |
| 连续改名请求可能乱序 | 同一素材的名称写入按顺序执行；失败不会阻塞之后的改名，当前失败提供重试 |
| 归档过程中改名可能漏同步 | 归档完成后读取当前节点名称补齐，保存仍使用最新画布状态 |
| 旧素材的 @ 引用显示文件后缀 | 引用标题采用统一的名称清理规则 |
| 显示名称不带后缀后下载文件缺少格式 | 资产页直接下载、后端附件下载与 ZIP 导出补齐格式后缀，保留名称中的小数点，例如 `镜头1.2.mp4` |
| 图片工具、视频工具与右键菜单的 AI 超分是可点击占位入口 | 明确显示暂未开放并禁用；本次没有声称接入不存在的 AI 超分服务 |

素材同步按资产 ID 和实际工作区执行。修改名称不会改动媒体内容、文件存储路径或其他节点的独立标题。后端沿用原路由、鉴权、响应信封和仓库实现；下载文件名在共享 handler/service 层处理，Memory/Gorm 无差异逻辑。

## 验证

日志及截图目录：`.tmp/canvas-asset-name-sync-20260924/`。

浏览器回归脚本：`apps/studio/e2e/canvas-asset-name-sync.spec.ts`。使用独立浏览器上下文和模拟 API，不写入真实用户项目、不调用生成服务。

- 图片、视频、音频、文本分别执行：加入素材库 → 改名 → 资产选择器读取 → 撤销 → 重做 → @ 当前画布分类读取 → 保存 → 刷新。
- 图片额外模拟服务端失败，确认不会伪报同步成功，点击重试后实际保存新名。
- 检查节点标题、素材接口接收名称、选择器无障碍名称、@ 显示名称；四个场景页面错误均为空。已人工查看同步后截图。

实际输出：

```text
archived image names follow rename, undo and reload across library entrances (8.5s)
archived video names follow rename, undo and reload across library entrances (7.0s)
archived audio names follow rename, undo and reload across library entrances (7.2s)
archived text names follow rename, undo and reload across library entrances (7.2s)
4 passed (30.4s)
```

单元与集成回归覆盖：真实素材工作区、连续请求顺序与失败恢复、手动文本快照保留、过期列表返回、重名变化与撤销、初始化/选择/拖动无写入、后端真实上传改名后下载文件头、ZIP 文件名及数字名称。

## 项目要求检查实际输出

```text
Studio check: tsc --noEmit，exit 0
Studio test:
 Test Files  222 passed (222)
      Tests  1584 passed (1584)
   Duration  11.46s
Studio build:
 ✓ built in 6.40s，exit 0

API go build ./...: exit 0
API go vet ./...: exit 0
API go test ./...: exit 0
 ok github.com/ai-manju/api/internal/handler 16.001s
 ok github.com/ai-manju/api/internal/service 8.761s
 ok github.com/ai-manju/api/internal/repository (cached)

Canvas Agent:
 ℹ tests 4
 ℹ pass 4
 ℹ fail 0

Director Desk:
 Test Files  87 passed (87)
      Tests  689 passed (689)

Worker compileall: exit 0
 Ran 118 tests in 2.202s
 OK (skipped=2)

git diff --check: exit 0
```

构建保留已有的大文件体积提示。全量并发验证时，原有批量导出进度测试出现一次依赖墙钟时间的断言失败（首次进度 82，而断言要求 100）；未改动该测试或进度逻辑，在其他重型检查结束后重跑完整 API 测试通过。

本地修改完成，保留共享工作区其他任务的修改，未提交、未部署、未重启共享服务。
