# 品牌中文名称更正为云途

用户指出页头 Logo 错写为“云格”，要求修复并直接推送。

## 修复

- 修正 7 个横版/竖版 Logo SVG 中实际绘制的“格”字路径为“途”，保留原来的云形、英文、颜色、尺寸与布局。
- 全部品牌 SVG 的无障碍名称、页面标题、manifest、品牌配置及加载器说明统一为“cloudto 云途”。相关已有端到端测试的名称定位同步更新；历史验收文档未改写。
- 页头 Logo 地址增加 `?v=yuntu`，避免沿用浏览器缓存中的旧字形。

## 验证

本地浏览器 localhost:3100/assets 实际显示“云途”。读取到标题 `cloudto 云途 · 创作工作台`，Logo alt 为 `cloudto 云途`，图片成功加载，尺寸 151.1875 × 42px。截图中确认实际绘制字形为“途”，非仅替换描述文字。独立测试标签页已关闭，没有操作用户资产。

实际截图：output/brand-yuntu/header.png；完整界面：output/brand-yuntu/actual-page.png。

41 个 SVG 全部 XML 解析通过，品牌 JSON / manifest 有效，Studio 产品代码与资源中的旧中文名称检索无结果。没有为此次文案/矢量字形修复增加测试。

日志：.tmp/brand-yuntu-20260930/。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test
Test Files 267 passed (267)
Tests 2104 passed (2104)
Duration 12.87s

pnpm --filter ai-manhua-studio build
✓ built in 6.54s
exit 0

go build ./... && go vet ./... && go test ./...
ok github.com/ai-manju/api/internal/service (cached)
exit 0

pnpm --filter @basketikun/canvas-agent test
tests 5
pass 5
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 689 passed (689)
Duration 90.25s

python -m compileall worker && python -m unittest discover -s tests
Ran 275 tests in 4.541s
OK (skipped=27)

git diff --check
exit 0
```

中间一次全量测试出现既有 comic/operationTask.test.ts 的 14 项超时/失败；单独重跑该文件 21 项通过，随后最终全量 2104 项全部通过。中间日志保留。构建仍有既有大 chunk / pnpm 配置提示。未执行上述端到端测试脚本，仅同步其定位文案；实际页面通过浏览器检查。

Go/Worker 使用隔离容器，没有重启服务或执行线上部署。提交仅包含此次品牌更正与本报告，不包含 output/ 或与本次修复无关的锁文件修改。
