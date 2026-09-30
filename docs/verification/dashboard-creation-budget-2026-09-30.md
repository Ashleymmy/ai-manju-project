# 工作台创作预估与配色验收

## 范围

按用户确认的方案 1 加少量方案 2 星点细节完成。只改工作台创作卡片及会员模块的报价公共导出；既有图片张数、项目日期和后台改动保留。未修改画布、节点、分组或管理员界面，未提交、部署或重启服务。

- 图片生成小卡片使用淡蓝渐变，视频保留淡紫。
- “本月创作”和“可用积分”图标最终按用户追加要求使用亮黄色线条 `#f6d65c`，没有底框、底色。
- 底部点击“看看还能创作多少”展开预估，窄卡片缩为“创作预估”。星点仅悬停/展开时略亮，无循环动画；支持减少动态效果设置。
- 模型来自现有图片目录，复用工作台同名模型收口及实际协议信息；当前只提供已发布的 1K 正方形规格。支持细节参数的协议提供低/中/高，不支持的协议仅提供标准规格。
- 选择模型和规格后调用 `/api/member/quote`，单张、无参考图，不发起生成。张数为可用积分除以服务端最终单张报价向下取整，会员折扣和取整由报价服务负责。
- 只接受明确的模型价目表报价；缺失、范围、基础兜底、零价、非法数值不猜测张数。切换参数取消旧请求，等待或失败时不展示旧数字；余额更新联动刷新估算，报价打开期间定期刷新。

## 实际页面验证

本地已登录账号，当前可用积分 600。

- `gpt-image-2`，1K 低画质：报价 10 积分/张，显示约 60 张。
- 切换 1K 高画质：报价 40 积分/张，显示约 15 张。
- 打开时不默认选择模型/规格，不显示未经报价的数字。
- 关闭按钮和 Escape 可以收起浮层。
- 1920、1600、1280 宽度下卡片高度保持 272px，窄卡片仅显示一份入口文字；1024 宽度下无横向溢出，浮层宽 340px，位于窗口内。
- 实测两个图标颜色均为 `rgb(246, 214, 92)`，背景透明、边框 0px。

截图：`output/creation-budget/actual-card.png`、`output/creation-budget/desktop-closed.png`、`output/creation-budget/actual-estimate.png`。卡片图为真实页面截图裁切。

## 验证输出

日志目录 `.tmp/creation-budget-20260930/`。pnpm 通过本地安装入口运行；Go 使用项目临时工具链；Worker 在已有镜像内禁网、只读挂载源码运行。

```text
pnpm --filter ai-manhua-studio check
> tsc --noEmit
exit: 0

pnpm --filter ai-manhua-studio test
Test Files  264 passed (264)
     Tests  2089 passed (2089)
  Duration  13.20s

最终小调整后：vitest run creationBudget.test.ts CreationBudgetPopover.test.tsx architecture.test.ts
Test Files  3 passed (3)
     Tests  25 passed (25)
  Duration  2.32s

pnpm --filter ai-manhua-studio build
✓ built in 6.56s
exit: 0

go build ./...
exit: 0
go vet ./...
exit: 0
go test ./...
ok github.com/ai-manju/api/internal/repository 0.273s
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service (cached)
exit: 0

pnpm --filter @basketikun/canvas-agent test
tests 5
pass 5
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  87.67s

python -m compileall worker && python -m unittest discover -s tests
Ran 275 tests in 4.068s
OK (skipped=27)

git diff --check
exit: 0
```

初次 Studio 全量发现 3 处新增跨 feature 深层导入，已收口为 member/index.ts 公共导出，重新全量通过。构建仍有项目原有的大 chunk 提示，没有构建错误。新增 15 个有意义的预算与交互用例覆盖不足余额、零价、缺失/范围报价、协议规格、按需加载、换参取消、晚到响应、后台刷新失败及重试。
