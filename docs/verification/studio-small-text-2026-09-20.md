# Studio 小字号可读性验收

## 范围

- 根据用户截图放大偏小的导航、品牌副标、辅助说明、标签、按钮和表单文字，不使用整页缩放。
- 共用字号集中定义在 `shared/styles/tokens.css`：caption 12px、small 13px、control 14px。
- 左侧导航 11px -> 14px；品牌副标 10px -> 12px；普通 UI 中原 9-10px -> 12px、11px -> 13px、12px -> 14px。原 13px 及以上声明保持不变。
- 覆盖共享控件、工作台、聊天、资产、项目、标签、提示词、技能、队列、设置、个人主页、会员、图像/视频页面及 Agent 辅助文字。
- 画布节点编辑器、缩放坐标、媒体尺寸、生成参数及导出内容不在本次修改范围；保留其他会话的全部既有改动。
- 放大后资产库原七列筛选栏会挤压按钮，改为按最小控件宽度自动换行。移动端导航限制在横向可滚动顶栏中，避免文字越出导航覆盖正文。
- 未提交、未推送、未部署。复用已运行的 `http://localhost:3100`。

## 浏览器验收

新增 `apps/studio/e2e/small-text-readability.spec.ts`。独立 Chrome context，所有业务 API 使用模拟数据，无真实生成、上传或项目写入。

覆盖 1920x1080、1280x800、390x844；检查工作台、技能库、资产库、项目、图片生成、视频生成页面。

- 检查导航、品牌副标、辅助说明实际字号。
- 确认工作台标题仍为桌面 42px / 窄屏 30px，统计数字 30px、积分数字 24px，创作输入正文 13px。
- 检查导航、按钮、统计单元格没有文字溢出；检查工作台页面无横向溢出。
- 检查手机导航位于顶栏边界内，能够点击滚动区域中的技能库链接。
- 查看桌面和手机截图；页面未出现运行时错误。

实际输出：

```text
small-text-readability.spec.ts: 3 passed
studio-agent-dialog.spec.ts: 2 passed (14.8s)
canvas-prompt-clipboard.spec.ts: 4 passed (54.8s)
```

截图保存在 `.tmp/small-text-qa/`；本机配置为 `.tmp/small-text.playwright.config.ts`。Agent 回归包括桌面/手机对话、发送、草稿、历史和画布工具；引用回归包括配置/图片/视频/文本节点复制、剪切、粘贴及重新加载。

## 项目验证

使用 `pnpm --config.verify-deps-before-run=warn --filter <package> <command>`，未安装或更新依赖。

```text
Studio check:
$ tsc --noEmit
exit 0

Studio test:
Test Files  184 passed (184)
Tests       1163 passed (1163)
Duration    8.49s

Studio build:
Director dependency: built in 3.96s
Studio: 2166 modules transformed.
built in 2.96s
exit 0

Canvas Agent test:
tests 4
pass 4
fail 0
duration_ms 70.6428

Director Desk test:
Test Files  87 passed (87)
Tests       686 passed (686)
Duration    90.08s

Go build ./...: exit 0, no output
Go vet ./...: exit 0, no output
Go test ./...: exit 0
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/provider (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router (cached)

Worker compileall worker: exit 0
Worker unittest discover -s tests:
Ran 89 tests in 0.583s
FAILED (failures=4, errors=7, skipped=2)

git diff --check: exit 0
```

Go 使用 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`，GOMODCACHE 指向 `.tmp/canvas-quality-qa/gomodcache`；Worker 使用 `.tmp/canvas-quality-qa/worker-venv/Scripts/python.exe`。

## 非本次改动的问题

- Worker 图像输出验证测试的多个子案例失败：返回 `image_output_unreadable`，预期为原图通过或 `image_output_size_mismatch`。该代码属于工作区其他改动，本次未修改。
- Worker 进程关闭测试在 Windows 上报 `AttributeError: module 'signal' has no attribute 'SIGKILL'`，本次未修改。
- pnpm 提示已安装依赖与锁文件不同步、旧 `pnpm.overrides` 字段被忽略；Director 构建保留部分资源超过 500kB 的警告。
