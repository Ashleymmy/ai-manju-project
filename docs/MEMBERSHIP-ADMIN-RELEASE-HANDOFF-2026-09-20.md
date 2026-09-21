# 会员后台交付与上云终测交接

日期：2026-09-20。当前结论：**本地开发、Memory/PostgreSQL 验证和远端代码整合已完成，可进入云端终测准备；尚未推送代码、发布镜像或修改云上服务。** 真实支付不在本次验收范围，模型接入配置沿用用户已验证的配置。

## 交付功能

- 原“用户”和“会员用户”合为“成员管理”，旧路由仍兼容。统一展示账号、角色、会员、积分、充值和时间；成员检索、会员/状态筛选在服务端全量筛选后分页。
- 超级管理员可变更会员等级、有效期，或改为免费成员。新变更替换当前会员并取消未开始的续期；旧积分保留到原有效期，新周期单独发放。操作原因进入审计；请求 nonce 防重复发放，旧版本请求返回 409。
- 新增“内部成员（测试用户）”，逐成员配置每 30 天积分额度，0 表示不自动发放。测试任务正常扣分、记录成本；此会员身份不会授予管理权限，也不出现在公开购买目录。
- “消耗与成本”按成员、项目、任务、模型以及小时/日/月汇总。任务详情含创建、开始、完成、结算时间、积分、模型、供应商（已记录时）、项目/工作区、执行次数和计价数量。支持筛选、项目/成员下钻、分页与全部筛选结果 CSV 导出。
- 平台成本独立于用户积分：人民币单价按调用、张、视频秒配置，保存生效日期和历史版本；任务账单实际总费用可由超管/运营录入，实际优先计入已知成本。支持 6 位小数，实际 0 与待核对明确区分，重复保存不累加。
- 邀请记录移除前端默认奖励数字提示，避免将静态默认值误当作当前运营规则。

## 已修复的审计问题

初次审计见 [历史报告](MEMBERSHIP-ADMIN-VERIFICATION-2026-09-20.md)。A1–A3、B1–B6 已补修并纳入回归：

| 问题 | 当前处理 |
|---|---|
| 运营创建超管、修改高权限账号 | 服务端限制运营只能管理普通成员；审计账号只读 |
| 不存在的账号可调积分 | 返回 404 |
| 套餐负数、非法配置 | 服务端校验价格、积分、并发、折扣、开关与相关 JSON 数值 |
| 重启覆盖运营套餐/积分包 | 种子仅创建缺失项，保留已有配置；内部套餐关闭公开销售 |
| 续期提前发放积分 | 将未来续期保存为 scheduled，到期衔接后发放 |
| 过期冻结积分取消后复活 | 释放时同步作废到期积分并记录过期流水 |
| 清理失败无法重试 | 完成积分清理后才转换会员状态，保留重试入口 |
| 并发超额准入 | Memory 锁/Gorm 事务与 advisory lock 原子统计并创建任务 |
| 前 200 个任务阻塞后续结算 | 结算扫描改为游标遍历并循环回扫 |

核心后台列表与新报表均走真实 API/仓库。未向现有业务数据库导入或删除数据；浏览器测试所用用户、任务、积分及账单全部在临时 PostgreSQL schema，属于隔离验收数据，不随产品发布。

## 远端整合与工作区保全

- 拉取前：`49dbe19`。执行 `git fetch origin --prune` 后合入 11 个远端提交，当前 HEAD 与 origin/master 均为 `7495216`（chore(web): 整合持久视频历史修复并完成全量验收）。
- 使用 fast-forward 与 autostash 保留本地修改；唯一冲突在 CanvasWorkspaceContent 的导入段，保留远端侧栏缩放和视频历史能力。无未解决冲突、`git diff --check` 通过。
- 合入后已重新运行下列检查。会员改动及原有品牌/会员页面等本地改动仍未提交，**部署不能只拿 origin/master，必须包含当前已验证的工作区改动和新增文件**。
- 合入前完整未提交文件备份：`D:\ITEM\membership-prepull-backup-20260920`，包含 `tracked.patch`、原 HEAD、状态清单及 10,068 个修改/未跟踪路径。自动暂存备份提交 `5d3a8d2` 仍保留，勿再次整批应用到当前工作区。

## 实际检查结果

完整输出保存在 [验收证据目录](audits/membership-2026-09-20/)。以下来自合入远端后的运行：

```text
apps/api: go build ./... / go vet ./... / go test ./...
build=0 vet=0 test=0
ok github.com/ai-manju/api/internal/repository 8.067s
ok github.com/ai-manju/api/internal/router     8.475s
ok github.com/ai-manju/api/internal/service    6.952s

pnpm --filter ai-manhua-studio check / test / build
check=0 test=0 build=0
Test Files 179 passed (179)
Tests      1110 passed (1110)

pnpm --filter @basketikun/canvas-agent test
tests 4 / pass 4 / fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests      686 passed (686)

Worker: python -m compileall worker && python -m unittest discover -s tests
Ran 82 tests; OK (skipped=1)

云部署脚本：Linux pytest
66 passed, 1 deselected, 2 subtests passed
```

API 回归启用了 TEST_DATABASE_URL，会员/成本与核心故障回归同时覆盖 Memory 和临时 PostgreSQL schema。Worker 用现有 `studio-beta-worker:20260911` 的 Python 环境挂载当前 Worker 源码只读、禁用网络运行；不是重用旧代码的测试结果。

云脚本在 Windows 上因符号链接权限和缺少 pytest 不能全部运行，改用临时 Linux 容器补齐测试依赖后通过。唯一被排除的测试需要 Docker Compose CLI，已在宿主机单独运行 `python -m unittest discover -s deploy/cloud/tests -p test_prepare_sdvideo_nas_test.py` 通过；只解析合成配置，不启动云服务。

浏览器连接真实本地 API 与隔离 PostgreSQL，完成：内部测试会员配置、单价录入、估算与实际费用核对、项目下钻、任务详情、CSV 按钮及重启后的持久化。验收样本为 1 个成功任务、100 积分、2 张 × ¥0.025 = ¥0.05，实际费用 ¥0.041；API 重启后这些值与成员 1,200 限时积分均保留。见 `ui-members-after-restart.txt`、`ui-costs-after-restart.txt`。正常视口文档宽度与 viewport 均为 1910，无整页横向溢出；浏览器缩放导致截图裁切，未将截图作为移动端验收证明。

## 云端终测步骤（尚未执行）

1. 基于当前工作区审核、提交待发布源代码，记录最终提交与 API/Web/Worker 镜像 digest。保留远端已合入的静态资源保留脚本；不要用未包含新增源文件的构建上下文。
2. 按既有 `deploy/cloud/compose.yml` 准备私有 compose 参数、runtime env、证书与 secrets；不要将本地测试账号/口令或测试 schema 复制到云端。示例 runtime env 已显式增加 `BILLING_ENABLED=true`。
3. 保持 `APP_ENV=production`、`STORAGE_DRIVER=postgres`、`REQUIRE_PERSISTENT_STORAGE=true`。核查 `BILLING_ENABLED=true`；调度/结算周期默认 60/15 秒。生产环境不开放 mock-pay，支付宝/微信未接通，本次不验收收款与退款。
4. 更新前备份 PostgreSQL、记录现有镜像和 runtime env 版本；先完成恢复演练。新 API 启动由 GORM 增加 `model_cost_rates`、`task_actual_costs`、`user_memberships.monthly_credits_override`，以及内部会员种子。确认没有迁移失败后再放行流量。旧版不认识 scheduled 与 internal_test，不应在有新会员变更后直接切回旧 API。
5. 用实际私有参数执行：`python deploy/cloud/check-release.py --compose-env <私有compose.env>`。示例域名/digest 占位值不能用于放行。此次只完成模板和脚本验证，未验证云端真实证书、密钥、网络或 NAS。
6. 健康检查通过后以超管登录：成员页面只剩一个入口；建立专用测试成员，指定内部额度；普通账号访问后台 403、审计账号不可写、运营不可提权。确认套餐配置经 API 重启仍保留。
7. 配置业务模型实际使用的模型标识/供应商和成本单价。以内部测试成员在一个项目生成小额任务，核对任务 ID、项目、时间、冻结/扣分/失败释放，再录入一笔账单总费用；对照 CSV、分组总计和明细。此步骤会调用现有模型，等用户启动云端终测时执行。
8. 出现扣分/迁移异常时停止新增任务并保留数据库、资产卷和日志。优先修复前进；如必须恢复旧库，需要同时恢复匹配的 API/Web 版本及备份，并核对备份后产生的任务和积分流水，避免丢账。不要删除卷。

## 使用边界与后续事项

- 单次报表最多 366 天、50,000 条事实，超限明确报错，需缩小时间/成员范围；当前为读取明细后聚合，后续规模增长需索引/预聚合与压测。
- 费用是单价估算或人工核对值，尚不自动同步供应商账单；文本目前支持按调用估算，不支持按 token 定价。重试、失败任务可能有真实支出，缺失费用不会被标成免费。
- 历史任务未存储的项目/供应商显示“未关联/未记录”，不会推测补造；内部成员按任务发生时的会员历史判定。历史成本单价补录会改变估算，已录入的实际费用不受影响。
- 1980 套餐等默认种子权益需运营在云端核定；报表数据正确不等于默认商业价格已经确认。
- 初次审计的支付履约重试、未付款退款、退款金额快照问题仍属真实支付接入前必须单独处理的后续项。本次不将其宣称为已修复或已验收。
- 构建成功不等于云端终测通过；下一步由用户发起明早发布与云端终测。
