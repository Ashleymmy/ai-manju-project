# 顶栏品牌标识放大

## 最终要求

先将左上角图标、中英文整体放大。用户随后明确选择“保留刚才整体放大的尺寸，再放大中文”。

- `shell.css`：横版标识高度从 30px 改为 42px，整体等比放大 40%，顶栏仍为 82px。
- `logo-horizontal-on-dark.svg`：仅中文“云格”组从 `scale(1.5)` 调为 `scale(2)`，额外放大约 33%；微调纵向位置至 `translate(392 153)`，保留英文与中文的间隔和底部留白。
- 图标和英文路径、各自 transform、SVG viewBox 保持不变。没有修改页面标题、导航、账号字号，也没有改变移动端原有隐藏品牌的规则。
- 保留矢量资产，无新增字体依赖、位图或拉伸变形。

## 验证

```text
Studio check: $ tsc --noEmit; exit 0
Studio test: Test Files 230 passed (230); Tests 1675 passed (1675)
Studio build: exit 0
Playwright brand-logo-size: 5 passed (12.4s)
API go build ./...: exit 0
API go vet ./...: exit 0
API go test ./...: exit 0; tested packages ok (cached)
Canvas Agent: tests 4; pass 4; fail 0
Director Desk: Test Files 87 passed (87); Tests 689 passed (689)
Worker compileall: exit 0
Worker unittest: Ran 131 tests in 2.058s; OK (skipped=9)
git diff --check: exit 0 (existing CRLF/LF warning only)
```

五个视口为 1920、1280、900、761、390px；验证图片已加载、宽高比例正确、标识无裁切、与面包屑及右侧账号区域不重叠。顶栏 1px 下边框造成的半像素中心差已在断言中考虑。最后调整中文后重新执行浏览器检查及构建。

测试使用隔离 API 响应，不操作真实用户数据。已目视检查同一整体尺寸下中文调整前后的截图：

- `test-results/brand-logo-size/brand-logo-size-brand-logo-58f0a-thout-moving-other-controls/brand-before-chinese.png`
- `test-results/brand-logo-size/brand-logo-size-brand-logo-58f0a-thout-moving-other-controls/brand-after.png`

使用既有本地服务 `http://localhost:3100/projects`。本轮只改两个品牌展示文件及相关测试/记录，保留工作区其他修改；未提交、推送或部署。沿用现有依赖，未处理与本轮无关的依赖同步、包体积警告。
