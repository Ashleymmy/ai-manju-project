# 资产助手步骤切换与预估入口调整

## 资产助手：已复现并修复

本地浏览器打开用户既有资产项目，初始进入“项目资产”，点击“上传剧本”后再点击“项目资产”，仍停留在上传页。根因是步骤按钮以 `目标步骤 <= 当前步骤` 判断能否进入，退回第一步等于把后续入口全部锁死，与项目是否加载无关。

修复使用实际已加载的数据判断可访问性：上传页可返回；有候选版本才开放审阅；已加载项目即开放资产页，不再受当前步骤编号限制。缺少分析时，审阅按钮灰显并展示“先解析剧本或找回分析记录”。既有资产不再冒充待审候选。

同一区域另外发现“解析并预览”按钮未绑定处理函数，候选确认操作虽已定义却未渲染。已接回现有分析与确认控制器；“取消”改成明确的“返回项目资产/返回候选”，只切换视图，不丢弃草稿。

新增 4 个集成回归用例：空项目往返、不重新加载；资产编辑草稿保留；找回候选后返回并确认、切换项目清理旧候选；解析预览调用真实控制器及返回候选。原有异步归属用例继续通过。

浏览器实测：上传页 → 项目资产、上传页 → 返回项目资产均成功，原项目 ID 和空资产状态保持。未在真实账号发起付费分析或创建测试项目；分析/确认链路用可控控制器测试。

## 工作台入口与配色

- 预估入口靠右，与积分明细形成一组；余额保留左侧。
- 入口星星图标换成计算器，无底框。实测 SVG 类为 `lucide-calculator`，线条颜色 `rgb(223,201,141)`。
- 图片淡蓝、视频淡紫保留；预估入口、流动星点和报价结果改用克制的暖金/米白，浮层底色为中性深灰绿，不再所有部件都用蓝紫。
- 1280 宽度下卡片仍为 320×272px，预估入口右边缘 1150px，明细左边缘 1156px，靠右排列、无文字重复或横向溢出。

截图：`output/comic-navigation/actual-project.png`、`output/comic-navigation/dashboard-card.png`。

## 实际验证输出

日志 `.tmp/comic-navigation-20260930/`。

```text
专项 ComicAssetsView.lifecycle.test.tsx
Test Files 1 passed (1)
Tests 30 passed (30)

pnpm --filter ai-manhua-studio check
> tsc --noEmit
exit: 0

pnpm --filter ai-manhua-studio test
Test Files 264 passed (264)
Tests 2093 passed (2093)
Duration 13.27s

pnpm --filter ai-manhua-studio build
✓ built in 8.01s
exit: 0

go build ./...
exit: 0
go vet ./...
exit: 0
go test ./...
ok github.com/ai-manju/api/internal/service (cached)
ok github.com/ai-manju/api/internal/storage (cached)
exit: 0

pnpm --filter @basketikun/canvas-agent test
tests 5
pass 5
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 689 passed (689)
Duration 116.44s

python -m compileall worker && python -m unittest discover -s tests
Ran 275 tests in 4.163s
OK (skipped=27)

git diff --check
exit: 0
```

构建仅有既有大 chunk 提示。未修改后端契约、画布、节点、分组；未重启服务或部署线上。保留其他助理及之前的所有未提交改动。
