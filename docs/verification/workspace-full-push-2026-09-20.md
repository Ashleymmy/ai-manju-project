# 工作区全部修改提交验收（2026-09-20）

本轮按用户“全部提交推送”的要求纳入所有 Git 管理范围内的本地修改，包括此前暂缓的功能及检查期间新增的剧本异步解析。没有强制纳入依赖、构建产物或被项目忽略的本地运行数据。

原工作区 master 的全部修改先保存为 e9709bf，再通过 dbedf0b 整合远端已有提交。合并保留视频独立请求、生成完成反馈及 Seedance 参考素材规则；Agent 素材引用、图片质量和视频历史测试均保留。

纳入内容包括：视频历史、剪贴板及 Ctrl+V、最近画布导航、独立复制、面板缩放、画布滚轮缩放、图片裁剪和预览恢复、图片分辨率/精细度与 Worker 参数传递、Agent 插话及素材引用、资产批量编辑、批量生成进度/重试、项目卡片操作、归档删除保护、静态资源升级连续性，以及剧本异步解析和网关错误处理。

## 验证

所有验证均在整合远端更新后执行。检查期间新增了异步解析代码与测试，因此补跑了受影响的前后端检查。

### Studio

命令：pnpm --filter ai-manhua-studio check / test / build。

```text
$ tsc --noEmit
exit 0
Test Files  175 passed (175)
     Tests  1098 passed (1098)
✓ built in 2.99s
exit 0
```

### API

一次性 Go 1.23 容器只读挂载工作区，执行 go build ./... && go vet ./... && go test ./...。

```text
exit 0
ok github.com/ai-manju/api/internal/handler 14.301s
ok github.com/ai-manju/api/internal/repository 0.005s
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service (cached)
```

### Canvas Agent / Director Desk / Worker

```text
pnpm --filter @basketikun/canvas-agent test
ℹ tests 4
ℹ pass 4
ℹ fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  686 passed (686)

python -m compileall worker
python -m unittest discover -s tests
Ran 82 tests in 0.445s
OK (skipped=1)
```

Worker 在一次性 Linux 容器内补齐 httpx==0.28.1 后运行，不更改项目依赖文件或运行中的容器。跳过项需要 REDIS_TEST_URL。

### 浏览器

本轮将十个相关测试文件组合运行，在 53121 端口启动独立 Studio，业务 API 全部模拟，不操作真实项目、不调用收费供应商。

```text
29 passed (1.7m)
exit 0
```

覆盖资产批量编辑、Agent 图片/视频引用、素材选择、Ctrl+V/右键粘贴、上传失败及离开画布保护、面板缩放、独立复制、最近画布入口、视频历史播放与应用、滚轮缩放和批量生成进度/重试。异步解析另有前端轮询、HTTP 上传提前响应、请求取消后后台完成及仓库并发回归测试；未调用真实模型验证剧本解析或人物发丝质量。

原始日志保留在本机 .tmp/push-all-*.log；未部署线上或重启现有服务。
## Memory / PostgreSQL 一致性验证

在禁用外部网络的一次性 PostgreSQL 16 空数据库中，单独执行新增仓库回归，覆盖重复任务拒绝、工作区隔离、并发只能完成一次、失败留存与过期清理。

```text
--- PASS: TestPendingAnalysisRepositoryParity (0.03s)
    --- PASS: TestPendingAnalysisRepositoryParity/memory (0.00s)
    --- PASS: TestPendingAnalysisRepositoryParity/postgres (0.03s)
PASS
ok github.com/ai-manju/api/internal/repository 0.032s
```

测试数据库已关闭并随容器清理；未连接用户业务数据库。`git diff --check` 通过。

## 最后新增浏览器回归

修正测试拦截器误拦截前端源文件、首次公告弹窗以及候选页面定位后，单独验证上传剧本 → 202 后台处理 → 状态读取遇到 HTML 504 → 自动继续读取 → 展示候选资产。提交次数仍为 1，没有重复生成请求。

```text
1 passed (12.5s)
exit 0
```

本轮浏览器回归合计 30 项通过（29 + 1）。
