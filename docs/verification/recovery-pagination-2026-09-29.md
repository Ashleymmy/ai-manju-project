# 后台生成任务恢复列表：五行视口、十条分页

日期：2026-09-29。已修改本地代码，未提交、未部署。

## 原因与修改

截图中的 12 条记录没有翻页，是因为原分页常量为 30。表格只有横向 overflow，没有纵向高度限制，记录会持续撑长页面。

- generationRecoveryApi.ts：每页从 30 改为 10，真实请求发送 `limit=10`，后续页 offset 为 10、20 等。
- GenerationRecoveryPanel.tsx：查询缓存键包含每页数量，避免旧 30 条页面缓存混入；表格根据前 5 条记录的实际底边计算最大高度，包含表头及折叠边框，文本换行时重新测量；翻页重建滚动容器并回到顶部。
- generationRecovery.css：列表内部纵向滚动、可见滚动条、固定表头；分页条留在滚动区域外，并显示“每页 10 条”和滚动提示。
- 保留所有任务字段、恢复操作及权限限制，没有裁掉详情或截断描述。
- 检查了服务层及 Memory/Gorm 实现：均支持传入 limit/offset；后端无需修改。

## 自动化回归

更新原有 API 和分页测试，新增边界及记录减少场景：

- 请求真实携带 limit=10、offset=10 和取消信号。
- 12 条：第一页 10 条，第二页 2 条；上一页/下一页状态正确。
- 切换页面不保留上一页的任务操作目标或滚动位置。
- 10 条禁止下一页，11 条启用下一页。
- 第二页刷新后总数从 12 减到 10，自动返回第一页，不停留在空页。
- 分页操作不触发任务恢复。

针对性检查：2 个测试文件、16 项测试通过。

## 浏览器验证与限制

真实本地后台恢复接口返回 HTTP 404，未能使用真实恢复记录进行端到端验证。没有重启服务，也没有向后台插入测试任务。

在独立临时页面中渲染实际 GenerationRecoveryPanel 组件，并向该页面自己的查询缓存注入 12 条明确标注的样例记录；所有恢复按钮禁用，未调用真实恢复操作。临时页面已关闭。

浏览器实测：

- 第一页有 10 条 DOM 记录，完整可见 5 条；视口高度 418px，内容高度 797px，可见细滚动条。
- 滚动至底部 scrollTop=379，第 10 条可见；表头与视口顶部坐标相同，保持固定。
- 第二页只有 2 条，scrollTop=0，显示“第 2 / 2 页”，下一页禁用。
- 返回第一页恢复顶部，并完整显示 5 条。

证据文件均明确为样例验证：

- `output/recovery-pagination/sample-page-1.png`
- `output/recovery-pagination/sample-page-2.png`
- `output/recovery-pagination/verification.json`

## 项目检查及实际输出

日志：`.tmp/recovery-pagination-20260929/`。下列 Studio 结果来自最后一次边界像素修正后的完整检查。

Studio check / test / build 均退出 0：

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

Test Files  262 passed (262)
     Tests  2073 passed (2073)
  Duration  12.95s

✓ built in 6.60s
```

API build / vet / test 均退出 0，build/vet 无输出，测试输出节选：

```text
go-build=0 go-vet=0 go-test=0
ok  github.com/ai-manju/api/internal/sdvideo (cached)
ok  github.com/ai-manju/api/internal/service (cached)
ok  github.com/ai-manju/api/internal/storage (cached)
ok  github.com/ai-manju/api/internal/tagmigration (cached)
```

Canvas Agent / Director Desk 测试均退出 0：

```text
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ duration_ms 187.4411

Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  102.33s
```

Worker 在已有镜像内只读挂载源码、关闭网络，compileall / unittest 退出 0：

```text
Ran 275 tests in 8.201s
OK (skipped=27)
```

`git diff --check` 通过，无输出。其他已有未提交修改全部保留。
