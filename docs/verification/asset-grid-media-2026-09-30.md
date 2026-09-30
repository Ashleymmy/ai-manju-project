# 资产库缩略图、媒体封面与独立滚动

## 完成内容

- 资产列表上方增加缩略图缩放控件，只调整中间卡片的列数。按最终反馈，最少 3 列，最多 8 列，窗口宽度不足时限制可增加的列数；3 列时放大按钮禁用。旧的 1 / 2 列偏好自动回到 3 列。
- 中间列表独立竖向滚动，筛选、缩放、分页在滚动区外。按最终反馈使用细滚动条，距右侧详情分隔线 2px。切换页码、目录、筛选或空间会回到列表顶部，缩放不重置滚动和选择。
- 每页请求 50 项，并统一分页计算及本页全选的范围。从外部链接打开不在当前页的资产时，详情数据与分页卡片分开，避免出现第 51 张卡片或挤掉当前页第 50 项。
- 视频复用现有真实封面接口，失败时显示封面暂不可用；音频用静态音频图标。没有添加假封面、时长或波形。所有卡片媒体区比例与名称区对齐，名称左侧显示资产类型线条图标。
- 血缘页签将原来的孤立连接线替换为“来源 / 当前资产”的文字信息；保留已有上游、下游关系及操作。

## 实际浏览器验证

在独立测试标签页 localhost:3100/assets 中完成，未操作用户标签页或资产内容：

- 第 1 页与第 2 页分别有 50 张卡片；验证时筛选总数 736，分页为 15 页。第 2 页滚动位置为 0。
- 网格滚动 540px 后，工具栏 y=308.890625、详情面板 y=21.390625 均保持原位。
- 勾选资产后滚动，选择保持；缩略图缩放也保持选择。
- 3 列时放大按钮禁用；1920px 窗口中卡片宽 344px，1366px 窗口网格宽 498px，仍为 3 列且页面没有横向溢出。
- 右侧滚动条与详情分隔线间距 2px，scrollbar-width=thin。
- 第一行类型图标为音频、视频、图片；视频封面图片 naturalWidth > 0，实际加载成功。
- 测试后恢复默认浏览器尺寸、3 列偏好，关闭测试标签页。

截图：output/asset-grid-media/actual-page.png。

## 实际验证输出

日志目录：.tmp/asset-grid-media-20260930/。

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit: 0

pnpm --filter ai-manhua-studio test
Test Files 267 passed (267)
Tests 2104 passed (2104)
Duration 12.99s

pnpm --filter ai-manhua-studio build
✓ built in 6.56s
exit: 0

go build ./... && go vet ./... && go test ./...
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/service (cached)
exit: 0

pnpm --filter @basketikun/canvas-agent test
tests 5
pass 5
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 689 passed (689)
Duration 123.85s

python -m compileall worker && python -m unittest discover -s tests
Ran 275 tests in 4.417s
OK (skipped=27)

git diff --check
exit: 0
```

本轮新增缩略图偏好/响应式边界测试，以及外部链接不增加第 51 项的回归测试。一次中间 Studio 全量测试中，现有 comic/operationTask.test.ts 出现 14 项超时/失败；单独重跑 21 项全部通过，随后最终全量 2104 项全部通过，保留中间失败日志供追查。最终构建有既有的大 chunk 提示；pnpm 配置及 CRLF/LF 提示不影响验证。

后端、Agent、Director Desk、Worker 在本轮较早阶段已验证通过，后续只修改 Studio；Go 与 Worker 使用隔离容器。没有重启已有服务、提交或部署，保留其他任务的未提交修改。
