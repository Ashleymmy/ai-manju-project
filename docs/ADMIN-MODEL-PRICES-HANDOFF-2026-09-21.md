# 后台模型积分定价编辑页验收与发布范围

- 用户需求：后台页面可修改上一轮会员价目表中的模型积分价格。
- 入口：管理后台 → 模型积分定价，路径 `/admin/model-prices`。
- 状态：实现与自动化验收完成，交接部署；未修改云端价格。

## 功能与数据

- 图片按模型、分辨率、画质编辑每张积分，参考图片附加费独立编辑（每个输出均计入，蒙版不计）。
- 视频按模型、分辨率编辑每秒积分。Seedance 1.5 区分无声/有声；其他视频区分无参考视频/有参考视频，支持视频参考加价的模型另有附加费，单价均按生成视频秒数计。
- 单价允许 0–1,000,000、最多两位小数，0 表示对应项目免费。既有模型和规格身份固定，不开放任意新增或删除价目行。
- 页面支持跨模型保留草稿、未保存修改数量、撤销未保存修改；保存失败保留草稿，保存中禁止编辑。只读审计账号只能查看。
- 沿用已有管理员权限和审计中间件：super_admin、ops_admin 可保存，auditor 只读，普通成员不能访问后台接口。配置审计记录带具体 key。
- 新增 GET `/api/admin/billing/model-prices` 读取有效价目表；沿用 PUT `/api/admin/billing/configs/model_credit_prices` 保存完整表，服务端验证所有模型、规格、画质顺序、单价范围、空值、精度和附加费能力。
- 使用已有 `billing_configs` 存储，不增加表、迁移、种子数据。未保存配置时沿用原默认表，不改变任何默认单价。
- 成员定价、生成报价和新任务冻结共用相同实时配置；旧任务保留原冻结记录，不因后续改价重算。Agent 保持免费。
- 保存后当前客户端成员查询立即失效刷新；其他活跃生成报价和会员定价页每 30 秒刷新。提交时服务端按最新配置报价和冻结。
- 基础兜底规则仍位于“套餐配置”；平台供应商成本仍在“消耗与成本”，与本页成员积分价格独立。

## 保留的结算边界

2026-09-22 用户确认：自动图片规格保留原基础兜底单价，并逐张计入参考图附加费，每个输出均计入、蒙版排除，页面显示实际报价。自动视频时长继续保留原基础扣费行为。只在引用视频时，总积分为 `(有参考视频单价 + 参考视频附加费) × 生成视频秒数`；引用图片、音频保持原视频单价。多个参考视频只加一次单价。H3 480p 默认 30/30/30，可在后台修改，读取旧表时只补新行并保留其余已保存定价。

## 验证与实际输出

日志位于本地 `.dsh-artifacts/model-prices-*.log`。

| 检查 | 实际结果 |
|---|---|
| API `go build ./...`、`go vet ./...`、`go test ./...` | 全部退出码 0；`ok github.com/ai-manju/api/internal/router 2.299s`，`ok github.com/ai-manju/api/internal/service 6.468s` |
| Studio `pnpm --filter ai-manhua-studio check` | `tsc --noEmit`，退出码 0 |
| Studio `pnpm --filter ai-manhua-studio test` | `Test Files 181 passed (181)` / `Tests 1115 passed (1115)` |
| Studio `pnpm --filter ai-manhua-studio build` | `✓ built in 3.99s`，退出码 0 |
| Canvas Agent `pnpm --filter @basketikun/canvas-agent test` | `tests 4 / pass 4 / fail 0` |
| Director Desk `pnpm --filter @ai-manju/director-desk test` | `Test Files 87 passed (87)` / `Tests 686 passed (686)` |
| Worker `python -m compileall worker` | 退出码 0 |
| Worker `python -m unittest discover -s tests` | 在已有 `studio-beta-worker:20260911` 镜像挂载当前 Worker 源码（只读、禁网络）执行：`Ran 82 tests` / `OK (skipped=1)` |
| `git diff --check` | 无输出，退出码 0 |

专项后端测试 `TestAdminModelPricesPersistQuoteAndAuthorization` 在 Memory 和独立临时 PostgreSQL 15 中均通过，PostgreSQL 分支实际执行未跳过：

```text
--- PASS: TestAdminModelPricesPersistQuoteAndAuthorization (3.92s)
    --- PASS: TestAdminModelPricesPersistQuoteAndAuthorization/memory (0.31s)
    --- PASS: TestAdminModelPricesPersistQuoteAndAuthorization/postgres (3.61s)
PASS
```

覆盖未登录 401、成员 403、审计账号写 403、管理员保存、非法值不覆盖旧配置、成员价目表/报价读取一致、审计记录，以及 PostgreSQL 重建 router 后仍读取保存价目。

服务层验证：Flare 1K/low 改为 7.5 后单张报价 8、两张报价及冻结 15；参考图 2.25 时两张汇总向上取整为 20；Seedance Fast 720p 改为 12.5 后 6 秒报价 75。改价前 5 积分任务在改价后仍结算 5；活动期间零价仍为零。

页面组件交互测试覆盖小数保存、跨模型切换保留草稿、保存失败重试、报价缓存失效、空值和超精度阻止提交、撤销修改、auditor 禁止编辑，以及 Seedance 音频列语义。

浏览器 CUA 调用仍返回 `Codex auth token is unavailable`，未进行浏览器视觉验收或云端登录验收；不可把组件交互测试当作浏览器截图验收。没有真实模型调用或支付操作。临时 PostgreSQL 容器已停止并自动删除。

## 发布交接

只包含本页相关 API、Studio 源码/测试及此报告。`packages/provider-hub` 的模型配置长列表问题由部署任务另行处理，不属于本次定价提交。

API 与 Web 需要一起发布；无需重启 Worker 或迁移数据库。上线后验证新后台入口、读取默认价目、权限和成员报价即可，不应为了验收直接修改云端收费单价，也无需调用真实生成或支付渠道。若要验证云端写操作，应使用用户明确指定的价格。
