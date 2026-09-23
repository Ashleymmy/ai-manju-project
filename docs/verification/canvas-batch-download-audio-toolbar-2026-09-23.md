# 画布批量下载、音频上传与文本工具条验收

日期：2026-09-23。状态：本地代码完成并验证，未发布线上。

## 交付行为

- 拖动框选后，选区操作条及多选右键菜单提供「批量下载」。原有「批量注册拟真人素材」保留。
- ZIP 包含选中的图片、视频、音频原文件，跳过文本和空节点；按节点记录的空间读取资产；同名文件自动增加编号，避免覆盖。
- 源文件逐个读取，避免同时发起大量请求。部分读取失败时保留成功文件并附带「下载失败说明.txt」；全部失败时显示错误，不提供空包。
- 图片、视频恢复原来的节点上方悬浮上传按钮，音频按同一参考样式新增「上传音频」。鼠标移入空节点时显示，文件选择器限定对应媒体类型，上传后填入原节点。视频/音频恢复原有双击编辑提示词。
- 文本节点工具条的生图操作、积分与字号横向排列，显示当前字号，保留字号调整及原有操作。

## 实现范围

新增 `features/canvas/services/batchDownload.ts`、对应单元测试、`ui/nodeToolbar.css` 及浏览器测试 `e2e/canvas-batch-download.spec.ts`。在 `CanvasWorkspaceContent.tsx`、`CanvasStage.tsx` 和 `CanvasNodeCard.tsx` 接入操作。

根据用户后续明确要求，撤回空媒体节点内部上传布局，统一恢复原有悬浮上传样式；保留失败图片/视频节点不展示冗长提示词的修复。其他助理的缩略导航、检查器等修改保留。不修改服务接口，不重启共享服务，不提交或推送。

此处批量下载在浏览器中生成 ZIP，适用于当前画布选择，不提供跨刷新恢复或无限容量保证；资产库原有后台导出流程保持原样。

## 浏览器验收

使用独立 3416 端口的 Vite 和 Chrome，所有业务接口模拟，不改变真实项目或资产。

- 框选后从空白区、节点、分组右键菜单和选区操作条下载：4 个场景通过。
- 解压校验仅包含选中原图且字节完全一致，未选节点不下载，个人/团队资产分别请求正确空间。
- 音频选择器为 `audio/*`，上传仍是同一节点且未新建多余节点：通过。
- 文本工具条在 100%、60%、150% 控件缩放下积分不溢出，字号从 14 增至 16：通过。已人工检查截图。
- 原有批量注册浏览器测试：3 个场景通过。

上述新浏览器测试前 5 项已通过；修正测试使用的缩放变量单位后，单独重跑最后一项，实际输出：

```text
ok 1 apps\studio\e2e\canvas-batch-download.spec.ts:115:1
  text toolbar keeps price and font controls on one line at different zooms (3.3s)
1 passed (4.6s)
```

最后一次工具条截图：`.tmp/canvas-download-qa/results/canvas-batch-download-text-13f19-one-line-at-different-zooms/text-toolbar.png`。

## 项目验证实际结果

```text
apps/api: go build ./... -> exit_code: 0
apps/api: go vet ./...   -> exit_code: 0
apps/api: go test ./...  -> exit_code: 0 (cached)

Studio check:
$ tsc --noEmit
exit_code: 0

Studio test:
Test Files  200 passed (200)
Tests       1348 passed (1348)
Duration    13.52s

Studio build:
✓ built in 5.25s
exit_code: 0

Canvas Agent:
tests 4
pass 4
fail 0

Director Desk:
Test Files  87 passed (87)
Tests       686 passed (686)
Duration    138.19s

Worker:
python -m compileall worker -> exit_code: 0
Ran 105 tests in 3.525s
OK (skipped=1)

git diff --check -> exit_code: 0
```

Worker 在一次性容器中挂载只读源码验证。已有构建包体积及 pnpm 配置提示未导致检查失败。Studio 与 Agent 验证日志保存在 `.tmp/canvas-download-qa/`。验证后仅调整浏览器测试缩放值及补充本文档，未再修改功能代码。

## 用户纠正样式后的最终验收

用户明确图一视频为参考，要求音频同样使用上方悬浮按钮，并恢复视频和其他节点原样。按该要求修正后，已查看图片/视频/音频三类截图，确认节点内部无新增上传按钮。音频上传仍落在原节点，视频和音频双击编辑正常，批量下载和文本工具条保持正常。

浏览器测试最终输出：`9 passed (32.3s)`，涵盖 4 个批量下载入口、音频实际上传、3 种节点悬浮上传位置及文件类型、文本工具条。

最终项目检查输出：

```text
Go build / vet / test: exit_code 0 (tests cached)
Studio check: $ tsc --noEmit, exit_code 0
Studio test: Test Files 200 passed (200), Tests 1357 passed (1357), Duration 9.95s
Studio build: ✓ built in 5.13s
Canvas Agent: tests 4, pass 4, fail 0
Director Desk: Test Files 87 passed (87), Tests 686 passed (686), Duration 99.92s
Worker: Ran 105 tests in 2.021s, OK (skipped=1)
git diff --check: exit_code 0
```

初次检查发现共享测试 `CanvasInspectorMentionInsertion.test.tsx` 使用了当前 Studio 测试版本不支持的 `toHaveBeenCalledExactlyOnceWith`。改为语义等价的次数与参数两条断言，保留其他助理的断连行为验证；随后类型检查与完整测试通过。

最终日志：`.tmp/canvas-download-qa/restore-*.log`。截图位于该目录 `results/canvas-batch-download-{imag,vide,audi}*/`。本次调整尚未发布线上。
