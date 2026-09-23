# 画布注册成功徽章

将共享 `CanvasSeedanceRegistrationButton` 的成功态从 `Check` 替换为 `BadgeCheck`，与用户参考图的认证徽章轮廓一致。保留现有绿色、尺寸、提示文案、禁用状态及注册逻辑。节点工具栏、输入面板和图片工具菜单共用此组件。

## 实际验证结果

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
tsc --noEmit -> exit_code: 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files 193 passed (193)
Tests      1289 passed (1289)

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
vite v7.3.6: built in 3.75s
exit_code: 0

node node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/cli.js test --config .tmp/asset-picker.playwright.config.ts --grep "green badge"
1 passed (3.6s)

apps/api: go build ./... -> exit_code: 0
apps/api: go vet ./...   -> exit_code: 0
apps/api: go test ./...  -> exit_code: 0 (cached)

pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4; pass 4; fail 0

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests      686 passed (686)

apps/worker: python -m compileall worker -> exit_code: 0
apps/worker: python -m unittest discover -s tests
Ran 105 tests in 1.359s
FAILED (failures=9, errors=17, skipped=2)
```

Go/Python 使用既有 `.tmp/canvas-quality-qa` 工具链。Worker 仍是之前的图片校验及 Windows SIGKILL 测试问题，本次未修改该模块，不报告全项目通过。

组件测试覆盖新完成注册和持久化注册恢复的徽章类型、成功样式和禁止重复注册。浏览器使用隔离 API 与保存过注册信息的图片节点，确认节点工具栏和输入面板同时显示 `BadgeCheck`，计算颜色均为 `rgb(101, 217, 155)`，已查看截图。

截图：`.tmp/asset-picker-qa/canvas-asset-picker-regist-88697-r-show-the-same-green-badge/registered-green-badges.png`。

最初浏览器用例误用了默认隐藏输入面板的导入节点，已改为与截图一致的普通注册节点后通过；未为测试更改应用原有面板规则。未调用真实注册、生成接口或写入用户项目。没有提交或推送。
