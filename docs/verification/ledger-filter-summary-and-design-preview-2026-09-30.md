# 积分流水全筛选汇总与完整设计预览

## 积分流水修复

原顶部“本页增加 / 本页扣减 / 本页净变动”使用前端分页 items 求和，而匹配条数使用全部筛选结果，两者统计范围不同。现将三项改为“增加合计 / 扣减合计 / 净变动”，全部采用后台按已应用的用户、流水类型、开始和结束日期汇总的真实金额。分页只影响列表。

- API 原路由、鉴权和响应信封不变；data 新增 summary.increase、summary.decrease。
- Memory 在同一锁内过滤和汇总，再分页；Postgres 在只读 REPEATABLE READ 事务中查询 COUNT、SUM 和分页结果，使用同一读取快照。
- 扣减统计使用负流水的绝对值；净变动为增加减去扣减。不改变任何积分账户或流水内容。
- 缺少汇总、请求失败、筛选切换期间显示“—”；不回退到本页金额，不把缺数据解释为 0。真实空筛选结果由后台返回 0。
- 测试覆盖跨页、越界空页、用户/类型/时间组合、日期端点、空结果、旧后台缺字段及失败状态。

本轮没有重启正在使用的 API，没有部署线上。当前旧 API 不返回 summary，新前端会如实提示汇总暂不可用；后台加载新代码后启用真实全量汇总。

## 三张设计预览

完整预览：C:/Users/JT/.codex/visualizations/2026/09/20/01a0bdfb-5ee6-70e0-85c0-973135b734a8/cloudto-studio-complete.html

仅修改独立设计预览，不改变资产库、视频生成、资产助手的真实业务页面，也不改画布节点和分组。

与本地原页面核对后补回：

- 资产库：分类标签交并集、智能视图、目录、分类/来源/类型/日期/排序筛选、批量选择/移动/标签/删除、导入导出/打包、详情五个标签页和发送画布等入口。
- 视频生成：原对话列表、生成器/任务历史/工具箱，提示词及引用、首尾帧、模型/比例/分辨率/时长/音频/水印参数。模型能力和价格仍以实际服务为准，稿中模型示例明确标注为预览。
- 资产助手：上传剧本、审阅候选、项目资产三个步骤，项目管理、分类模板、提示词草稿与已确认版本、批量生成参数与后台批次。确认候选与生成批次保持独立。

浏览器验证详情标签页、导出弹窗、视频任务历史/工具箱、示例模型解锁时长、提示词弹窗、助手步骤切换及张数联动。约 1024、736、320 宽度检查无水平溢出；桌面三张预览共享 1290px 高度。检查时无浏览器 console error。

这是示例数据的交互布局预览；保存、上传、删除和生成等操作不会写入真实数据，部分入口仅演示弹窗。

## 实际验证输出

日志目录：D:/AImanju4.0/.tmp/ledger-summary-20260930/

```text
go build ./...
exit: 0
go vet ./...
exit: 0
go test ./...
ok github.com/ai-manju/api/internal/service 7.027s
exit: 0

Postgres 16 integration:
go test ./internal/repository -run TestGormCreditRepositorySemantics/LedgerSummaryUsesAllMatchingRowsBeforePagination -v -count=1
--- PASS: TestGormCreditRepositorySemantics (0.86s)
    --- PASS: TestGormCreditRepositorySemantics/LedgerSummaryUsesAllMatchingRowsBeforePagination (0.01s)
PASS
ok github.com/ai-manju/api/internal/repository 0.861s

pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit: 0
pnpm --filter ai-manhua-studio test
Test Files 265 passed (265)
Tests 2098 passed (2098)
Duration 13.57s
pnpm --filter ai-manhua-studio build
✓ built in 9.31s
exit: 0

pnpm --filter @basketikun/canvas-agent test
tests 5
pass 5
fail 0
pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 689 passed (689)
Duration 130.05s

python -m compileall worker && python -m unittest discover -s tests
Ran 275 tests in 4.021s
OK (skipped=27)

git diff --check
exit: 0
```

Go 使用隔离的 Go 1.23 容器；数据库集成测试使用本轮专属、无宿主端口的 Postgres 容器。Worker 最终使用现有项目 Worker 镜像启动隔离无网络容器，挂载当前代码只读；未修改正在运行的 Worker。

初次 Worker 验证使用基础 Python 缺 psycopg，旧 QA venv 随后出现依赖/图像读取相关失败（275 tests，failures=12，errors=18，skipped=30）；换用项目镜像后全部通过。前两次日志分别保留在 worker-test-missing-dependency.log、worker-test-old-venv.log，成功结果为 worker-container.log。未为通过测试修改 Worker 代码。

Studio check 期间依赖仓库请求曾超时并成功重试；构建有已有大 chunk 提示。保留其他任务全部未提交改动，本轮没有提交。
