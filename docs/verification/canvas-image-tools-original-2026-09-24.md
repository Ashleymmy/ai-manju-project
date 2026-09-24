# 画布图片工具原图质量修复

## 原因与改动

画布标注、蒙版与图片工具弹窗此前使用 `imageSrcFromNode(node, previews)`，取到了节点的缩略图。标注导出虽按输入图片的自然尺寸生成 PNG，但输入已经是缩略图，因此保存结果也会降低分辨率；蒙版的像素尺寸同样不正确。

三个工具入口现在复用 `useCanvasOriginalImage`，直接读取原始资产，独立处理加载、失败重试和关闭时的资源释放。加载完成前禁止标注保存或蒙版提交，不用缩略图降级代替原图。标注、蒙版显示原始像素尺寸。

工具结果按实际输出记录 naturalWidth / naturalHeight，并保留来源的模型、质量和分辨率选项。节点加载缩略图时，不再覆盖已知的原始尺寸。小节点仍使用缩略图。

检查了裁剪、聚焦、翻转、分割、超分、压缩、扩图与多角度的执行来源：已有 `imageSourceForNode` 使用原图。普通大图预览与下载也已使用原图。标注保存为原尺寸 PNG；只有用户主动选择的裁剪、缩放、压缩等操作按各自设置改变输出。图片工作台的共享标注入口使用 `resolveFullImageUrl`，没有依赖画布缩略图缓存。

## 浏览器实测

新增 `apps/studio/e2e/canvas-image-tools-original.spec.ts`。用 2048 × 1024 原图和颜色不同的 256 × 128 缩略图区分数据来源，实际操作工具并截取上传文件：

- 小节点请求带 thumbnail 参数。
- 蒙版画布为 2048 × 1024；裁剪预览 naturalWidth 为 2048。
- 延迟原图加载时显示加载状态，保存按钮禁用。
- 标注 SVG 使用 2048 × 1024 坐标，鼠标绘制后保存 PNG 仍为该尺寸。
- 检查未标注区域的颜色和一个单像素细节，均与原图一致。
- 新节点保存真实尺寸与质量设置。
- 实际点击下载，下载字节与上传的标注文件完全一致。
- 无 pageerror。

实际输出：

```text
node node_modules/@playwright/test/cli.js test --config .tmp/canvas-image-tools-original.playwright.config.ts
1 passed (9.7s)
```

截图已目视检查：`.tmp/canvas-image-tools-original-results/canvas-image-tools-origina-c8a62-ile-canvas-keeps-thumbnails/annotation-original.png`。

## 项目验证

直接运行已安装的命令入口，避免 pnpm 包装器重新同步共享依赖。Studio 的 check / test / build 及 build:deps 中的协议与 Director Desk 构建均已执行。

```text
Studio: tsc --noEmit
exit_code: 0

Studio: vitest run
Test Files  223 passed (223)
Tests       1612 passed (1612)
Duration    10.96s

Studio: vite build
✓ built in 6.35s
exit_code: 0

Canvas Agent: protocol tsc / agent tsc / scripts/build.mjs / node --test tests/*.test.mjs
tests 4 / pass 4 / fail 0

Director Desk: tsc -b / vite build / vitest run
Test Files 87 passed (87)
Tests      689 passed (689)

API: go build ./... / go vet ./... / go test ./...
exit_code: 0
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/service (cached)
其余含测试包均为 ok。

Worker: compileall worker / unittest discover tests
Ran 118 tests in 2.061s
OK (skipped=2)

git diff --check
exit_code: 0
```

Go 使用已有 `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe` 与模块缓存。默认 PATH 缺少 Go，默认 Python 缺少 Worker 依赖；最终 Worker 验证复用 `ai-manju-worker-monitoring:20260923` 镜像，只读挂载当前源码，缓存写入临时容器。未安装依赖、未重启共享服务。构建存在既有大分块提示。

本次只修改图片工具原图相关部分，保留共享工作区其他任务的变更，未提交或部署。此前已从缩略图保存出的低分辨率历史文件不会自动恢复细节，需从仍保留的原始节点重新编辑。
