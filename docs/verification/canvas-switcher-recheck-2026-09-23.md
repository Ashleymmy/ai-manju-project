# 正确截图复查：当前画布打开，但切换弹窗为空

## 截图与线上取证

用户提供的正确截图：顶部显示“我叫MT-2”，右侧仍有节点；搜索框显示占位提示，列表显示“无匹配画布”，底部只有“新建画布”。这说明截图展示的是切换弹窗的空状态，不能由截图推断数据库记录已经被删除。界面尚未出现前一轮本地修复新增的“刷新列表”。

按用户之前确认，按线上问题继续核查。通过浏览器工具实际打开此前用户提供的线上画布地址时，工具返回 `net::ERR_CONNECTION_CLOSED`；未取得线上鉴权列表或数据库记录。已询问“我叫MT-2”的准确网址，目前未收到补充。没有登录、部署、恢复备份或修改线上数据。

## 本轮补充修复

前一轮已经区分列表加载/失败/真正空列表、保留缓存并支持重试；本轮补上“项目详情已成功读取，但列表为空或遗漏当前项目”的独立场景。

- 只从当前画布成功的详情/会话加载结果取得元信息，保留当前画布入口。
- 列表失败仍报告失败；成功列表缺少当前画布时提示“列表暂不完整，已保留当前画布，请刷新重试。”
- 详情兜底与列表缓存分离，不会把不完整列表标成已经完整加载，不向列表缓存或快照写入伪造记录。
- 完整列表恢复后自然合并去重，提示消失。
- 兜底绑定用户、工作区及当前路由；切换会话清空，防止跨账号/工作区/画布残留；重命名同步兜底名称。

本次变更只涉及 `entities/project/useProjectSummaries.ts`、对应单测、项目模块导出、`CanvasWorkspaceContent.tsx` 及原浏览器回归测试。后端、自动保存实现和其他助理正在开发的功能未修改。

这项补充保障当前已确认的画布仍可见；它不能凭空恢复列表接口未返回的其他历史项目。线上旧画布的实际记录仍需成功连接后核验。

## 验证输出

日志：`D:\AImanju4.0\.tmp\canvas-switcher-recheck-20260923\`。

Studio 使用已安装的 pnpm CLI，执行项目规定的 check、test、build，退出码均为 0：

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

 Test Files  209 passed (209)
      Tests  1443 passed (1443)
   Duration  11.38s

✓ built in 6.43s
```

构建有既有的部分产物超过 500 kB 提示。

专项单测：

```text
✓ src/features/canvas/controllers/project-session.test.ts (5 tests)
✓ src/entities/project/useProjectSummaries.test.tsx (7 tests)
Test Files 2 passed (2)
Tests 12 passed (12)
```

新增测试覆盖：成功空列表保留当前详情且不改写列表缓存；恢复完整列表后清除提示；失败列表保留当前详情；跨账号、空间和切换画布清除兜底。

浏览器测试使用本地既有开发服务，所有 API 由测试隔离，未写入用户数据。新增 200 空数组场景，同时保留前轮 503 重试、旧列表保留、新建后刷新、保存失败不跳转测试：

```text
ok 1 ... canvas switcher recovers from failed lists, keeps loaded canvases and refreshes on reopen (6.3s)
1 passed (6.8s)
```

截图：`.tmp/canvas-switcher-recheck-20260923/browser/canvas-switcher-recovery-c-4534a-ses-and-refreshes-on-reopen/empty-list-keeps-verified-current.png`。已查看：当前画布仍在列表内，提示清晰可见，有重试和刷新入口。

API 按规定在 `apps/api` 执行已有 Go runtime 的 build、vet、test，退出码均为 0；build/vet 无输出，test 摘录：

```text
ok github.com/ai-manju/api/internal/handler    17.857s
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router     (cached)
ok github.com/ai-manju/api/internal/service    (cached)
```

本轮未设置 PostgreSQL 集成测试环境变量，相关可选测试跳过；后端实现没有改变，Memory/PostgreSQL 的实际集成验证见前轮 `canvas-switcher-recovery-2026-09-23.md`。

其余规定检查全部完成：

```text
Canvas Agent: tests 4, pass 4, fail 0
Director Desk: Test Files 87 passed (87), Tests 689 passed (689), Duration 88.32s
Worker: Ran 118 tests in 4.049s, OK (skipped=2)
```

Worker 使用只读源码挂载的一次性容器，执行 compileall 和 unittest；无共享服务重启。
