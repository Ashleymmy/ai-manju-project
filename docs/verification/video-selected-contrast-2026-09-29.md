# 视频参数选中文字对比度修复

日期：2026-09-29。验证页面：http://localhost:3100/video（用户实际登录会话）。

## 修改

- `apps/studio/client/src/features/video/styles.css`：比例、分辨率选中项采用浅色背景 `#e3e6df`、深色文字 `#1b2420`、字重 600；悬停规则排除选中项。
- `apps/studio/client/src/pages/video-workbench/workbench.css`：同步共享旧样式，避免素材面板加载后覆盖选中文字。
- 选中且禁用的按钮使用 `#343c37` 背景、`#bfc8c1` 文字和完整不透明度。

## 实际页面验证

浏览器实际读取的选中项 `16:9`、`720p` 均为：foreground `rgb(27, 36, 32)`，background `rgb(227, 230, 223)`，weight `600`。实际截图保存在 `output/video-selected-contrast/actual-page.png`，已目视确认文字清楚。

按颜色计算，正常选中态对比度约 12.62:1，禁用选中态约 6.63:1。实际指针悬停未单独证实；CSS 明确排除 active 按钮，避免悬停规则覆盖深色字。未修改生成参数或模型配置。

## 验证结果与实际输出

完整日志位于 `.tmp/video-selected-contrast-20260929/`。

- API：`go build ./...`、`go vet ./...`、`go test ./...` 均退出 0。build/vet 无输出，测试包结果均为通过或无测试文件。例如：

```text
ok  github.com/ai-manju/api/internal/handler (cached)
ok  github.com/ai-manju/api/internal/provider (cached)
ok  github.com/ai-manju/api/internal/repository (cached)
ok  github.com/ai-manju/api/internal/router (cached)
```

- Studio 类型检查退出 0：

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit
```

- Studio 首次测试有 14 项失败，集中在未修改的 `src/entities/comic/operationTask.test.ts`，包含 5000ms 超时及后续状态断言失败。未修改相关源码或测试，完整重跑通过；尚未证实首次失败根因。重跑实际输出，退出 0：

```text
Test Files  261 passed (261)
     Tests  2064 passed (2064)
  Duration  12.57s
```

- Studio 构建退出 0（保留已有大于 500kB 的 chunk 提示）：

```text
✓ built in 6.47s
```

- Canvas Agent 测试退出 0：

```text
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ duration_ms 89.3258
```

- Director Desk 测试退出 0：

```text
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  91.16s
```

- Worker 编译与单元测试退出 0：

```text
Ran 275 tests in 9.455s
OK (skipped=27)
```

- `git diff --check` 通过，无输出。

未提交、未部署。其他已有未提交修改保留。
