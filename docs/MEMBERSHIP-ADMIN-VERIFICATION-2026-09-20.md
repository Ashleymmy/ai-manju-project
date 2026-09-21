# 会员系统与管理后台验收记录

> 本文为修复前的历史审计。后续已实施修复、补齐成员与成本后台并合入远端更新；当前验收结论见 [会员后台交付与上云终测交接](MEMBERSHIP-ADMIN-RELEASE-HANDOFF-2026-09-20.md)。下文的“未修改产品代码”和阻塞结论仅描述初次审计时的状态。

日期：2026-09-20。结论：**暂不放行会员系统上云。现有后台有真实接口和持久化基础，可以继续完善；不能将页面齐全或原有测试通过视为业务验收通过。**

本轮检查当前工作区代码、两套仓库实现、真实路由以及本地运行数据库。用户已明确：真实支付渠道暂不检查，模型配置已由用户验证通过，不重复测试或修改。本文涉及的支付履约问题单独留待后续，不以未接支付渠道作为本次阻塞理由。

本轮只新增验收报告和可复现探针，没有修改产品代码、配置或现有业务数据。工作区仍有其他人在修改视频/画布相关文件；原有测试结果对应执行时的工作区，不能作为之后所有修改的发布证明。受审关键文件的 SHA-256 见 [source-manifest.txt](audits/membership-2026-09-20/source-manifest.txt)。

## 1. 后台的数据到底是不是真的

当前 `features/admin` 的用户、会员用户、积分流水、任务消耗、套餐配置、运营看板、邀请记录、审计日志均通过 API 客户端请求后端。没有在本轮检查的这些生产代码路径中发现用于填充列表的 mock 用户、订单或流水数组。测试文件中的 `vi.mock` 属测试替身，不是运行页面的数据源。

对现有 `ai-manju-project-api-1` / `ai-manju-project-postgres-1` 进行了只读核查：

```text
APP_ENV=production
STORAGE_DRIVER=postgres
REQUIRE_PERSISTENT_STORAGE=true
BILLING_ENABLED=true

users                  8  (member 7, super_admin 1)
credit_accounts        0
credit_ledger_entries  0
user_memberships       0
orders                 0
admin_audit_logs       0
```

查询在 `BEGIN READ ONLY` 事务中执行。会员、订单、积分表目前没有记录，因此没有证据表明这些表被 mock 业务记录污染；这也意味着现有环境尚无这些业务闭环的实际使用证据。未根据用户名推断现有 8 个账号是否为演示账号，也未删除任何数据。结论仅覆盖上述本地运行实例，不代表其他服务器或其他构建版本。

仍有容易被误认为 mock 的内容：

- **默认套餐数据**：两档会员、积分包和规则为启动种子。其中 1980 档的权益仍带“待运营确认”的代码注释；它们是实际配置，并非可直接当作最终业务规则的样例。
- **邀请规则提示**：`InvitesPanel.tsx` 使用前端常量显示默认奖励，虽然标注“默认”，却不会随着后台修改自动更新。邀请记录本身走真实接口。
- **无数据时的统计值**：任务消耗和监控没有终态数据时，成功率默认显示 100%；这是默认计算结果，不是实测成功率。旧用户/监控控制器也没有完整向页面暴露查询失败状态，接口错误可能呈现为空列表或默认数字。
- **会员筛选**：当前只过滤服务端返回的这一页，页面已注明“当前页”；尚不能当作全库会员检索。

## 2. 已验证可工作的基础

新增的后台探针使用完整 `router.NewWithConfig`、真实登录、真实鉴权中间件和真实 handler；没有手工伪造当前用户或替换业务响应。PostgreSQL 使用临时容器中的独立 schema。

| 验证项 | 结果与边界 |
|---|---|
| 10 个核心后台 GET 接口 | 未登录 401、普通用户 403、审计/运营/超管 200；Memory / PostgreSQL 均通过 |
| 审计账号禁止写积分 | POST 返回 403；两套实现通过 |
| 运营给已存在用户调增 321 积分 | 用户端实际读到余额 321；两套实现通过 |
| 相同 nonce 重放积分调整 | 余额仍为 321，仅 1 条积分流水；两套实现通过 |
| 积分调整审计 | 能查到操作人及操作理由；两套实现通过 |
| PostgreSQL 重新初始化完整路由 | 余额 321 和 `register_bonus_credits=1731` 保留；通过。**套餐/积分包种子不在此结论内，见 B1** |

这证明后台具备真实数据链路，但下面的越权和业务边界问题仍使其无法通过上线验收。

## 3. 必须修复的后台问题

### A1 P1 运营管理员可以提升为超级管理员

实际完整路由结果，在 Memory / PostgreSQL 均一致：

```text
ops created super_admin HTTP=201; want 403
ops self-promotion HTTP=200; want 403
```

`router.go:290` 的用户创建/修改只经过 `RequireAdmin`；`handler/auth.go:324` 接受请求指定的角色，`:384` 直接更新目标角色，没有检查操作人能否分配该角色或管理目标账号。审计账号被拒绝写入，并不代表运营与超管已正确分权。

修复验收：后端强制角色分配与目标账号权限；运营不得授予超管、修改自身角色或接管更高权限账号。覆盖创建、修改、密码重置、禁用等路径。前端按同一权限矩阵展示按钮。不得仅在 UI 隐藏选项。

### A2 P2 不存在的用户也能获得积分

实际结果：`nonexistent user credited HTTP=200; want 404`，两套实现一致。

`handler/admin_member.go:100` 将 URL 中的任意用户 ID 直接传入账本；账本自动创建账户，未先验证用户存在。由此产生找不到对应成员的账户和流水。

修复验收：用户不存在时返回 404，不产生账户、积分流水或成功操作审计；已存在用户的幂等调整保持不变。

### A3 P1 套餐与配置缺少服务端业务校验

实际结果：`negative plan price HTTP=200; want 400`，两套实现一致。

`handler/admin_billing.go:162` 直接保存月价等字段。配置写入也主要检查 key 白名单和 JSON 格式，不能保证积分、价格、并发、折扣和配置结构合法。前端表单检查无法保护直接调用 API 的管理操作。

修复验收：后端统一验证价格、积分、并发、折扣范围以及各配置 key 的具体结构；非法修改不落库。明确“0”的含义，禁止界面显示已关闭、服务端却静默回退默认值。

## 4. 会员与积分业务阻塞

以下六个探针在 Memory / PostgreSQL 均失败，共 12 个失败用例。真实支付渠道没有参与；会员周期场景用测试订单建立初始会员状态。

### B1 P1 重启覆盖运营配置并重新上架套餐

复现：把默认会员月价设为 12345 分、下架；把 `pkg_600` 改为 777 积分、下架；重新执行启动种子。

```text
restart: plan price=19800 enabled=true; pack credits=600 enabled=true; want 12345/false/777/false
```

入口为 `router.go:69`；`membership_seed.go:35` 调用会覆盖业务字段的 `SeedPlans`，`:48` 无条件 Upsert 默认积分包。

修复验收：缺失记录才初始化，已有业务配置不覆盖；运营修改后重启/扩容两个副本，价格、权益、上下架状态保持不变。后续种子版本升级使用显式迁移。

### B2 P1 续期会员可能在新周期无积分可用

复现：同日开通并续费两个 30 天周期，推进到第 32 天并执行调度。会员仍有效，却没有月积分。

```text
day 32: active renewed membership has 0 credits; want 19800
```

`payment_service.go:222` 将新会员起点放在旧会员到期时；但 `credit_ledger_service.go:172` 把尚未开始周期的负索引强制设为 0，提前发放新周期积分。其 31 天有效期从提前发放时开始计算；进入续期后，同一个周期 key 阻止重新发放。

修复验收：周期未开始时不得提前消耗该周期发放资格；每个实际生效周期恰好发放一次，积分有效期与确定的业务周期一致。覆盖提前续期、多次续期和年付。

### B3 P1 到期前冻结积分在取消后重新可用

复现：月会员冻结 30 积分；会员第 30 天到期清理后取消任务。原批次的 31 天期限尚未到，释放冻结后重新出现 30 可用积分。

```text
expired member regained 30 spendable credits after cancellation; want 0
```

`credit_repository_gorm.go:581` / `credit_repository.go:793` 只减少冻结量；到期清理保留冻结份额，却没有保留“会员到期强制失效”的完整状态。`expire:<grant_id>` 又是单次键，后续过期处理也需要覆盖释放后的剩余量。

修复验收：区分冻结、可用和已作废额度；会员到期后取消任务只释放冻结责任，不重新给可用积分；有效会员下普通取消仍正确退回；在途成功只结算一次。

### B4 P1 到期清理中断后不能重试补偿

复现：先成功将会员状态改为 expired，随后查询赠送积分时注入一次数据库错误，再次运行清扫。

```text
expired membership retains 19800 credits after retry; want 0
```

`credit_ledger_service.go:253` 先改变会员状态，再清积分；后续只扫描 active 会员，失败的后半段永久脱离这条补偿路径。其积分可能继续可用至批次自然过期。

修复验收：状态变化与积分作废原子完成，或保存可重放的待清理状态；在任意步骤故障/重启后补偿完成且不重复扣。

### B5 P1 并发准入不是原子操作

用同步屏障让两个请求在建任务前读到相同活动任务数，两套实现都允许免费用户同时提交两个视频任务：

```text
accepted 2 simultaneous video jobs; free tier limit=1
```

`entitlement_gate.go:97` 先计数；`job_service.go:111` / `:237` 调用准入后，分别在 `:132` / `:254` 建任务。计数与创建之间没有跨请求/跨副本的原子占位。

修复验收：使用跨副本有效的原子占位/事务；并发提交不能越过档位上限，取消、失败、入队错误和进程异常能释放或回收占位。

### B6 P1 结算扫描被前面的运行中任务阻塞

创建至少 200 个旧运行任务，再创建一个已完成任务，连续扫描三次：

```text
completed job after 200 running reservations remains reserved after 3 sweeps; want settled
```

`credit_reconciler.go:78` 每轮只取最旧 200 条冻结记录，运行中记录继续留在原位；`credit_repository_gorm.go:293` 固定按创建时间排序限量。新的完成任务无法被扫描到，冻结不能及时结算/释放。

修复验收：游标遍历、轮转扫描或按终态关联查询，保证有上界的处理延迟；单个坏记录或长任务不能阻挡后续已完成记录；至少覆盖超过两个批次的混合状态。

## 5. 后台完整性矩阵

| 管理能力 | 当前情况 | 上线前需要达到的状态 |
|---|---|---|
| 用户与角色 | 真实创建/修改接口；存在 A1 越权 | 后端角色和目标账号权限矩阵；旧用户面板也正确禁用审计账号写入口 |
| 成员信息 | 真实会员/余额/时间信息；筛选只对当前页有效 | 全库搜索、等级/状态筛选与分页统一；详情可追踪关联任务和流水 |
| 积分调整 | 真实写账、同 nonce 幂等、基础审计可用 | 修复 A2；重试复用同一 nonce，避免网络响应丢失后再次提交重复调账；显示操作理由及结果 |
| 会员开通/延期/撤销 | 有底层会员与兑换码服务；现有会员面板主要只有调积分、重置邀请码 | 支付未接时明确运营发放入口和审批/审计规则；提供兑换码后台 UI 或正式受控操作流程 |
| 套餐和积分包 | 真实编辑已有记录；启动会覆盖 | 修复 A3/B1；新建、下架、权益开关及周期配置形成完整流程 |
| 活动/注册/邀请配置 | 真实 JSON 配置编辑 | 按 key 的表单与后端校验；默认值、当前值、是否生效清楚区分；邀请提示读当前配置 |
| 流水与消耗 | 真实分页接口和列表 | 修复 B3–B6；保留状态/模型/参数/关联 ID；统计与筛选口径明确 |
| 运营看板 | 真实聚合的 7 项卡片 | 趋势图、日/月报表及导出尚未形成文档要求的完整能力；无数据/失败不得呈现“已测 100% 成功” |
| 导出 | 本轮检查的会员后台面板/API 客户端未发现正式导出操作 | 导出要跨全部页、服从筛选和权限；不能用当前页冒充全量 |
| 审计 | 写操作真实留痕，基础查询可用 | 配置前后值、操作结果与理由；现有数据库角色是 owner/superuser，`REVOKE ... FROM PUBLIC` 不构成其不可删改保证；部署前落实角色隔离 |
| 模型配置 | 用户已验证通过 | 本轮不改动、不重复验收 |
| 支付/退款 | 用户明确暂缓 | 不列为本轮渠道接入阻塞；正式接支付时单独验收 |

当前没有证据支持推倒后台重做。建议沿用页面、API 和仓库基础，按“权限与数据安全 → 配置持久化与校验 → 积分生命周期 → 运营操作完整性”的顺序补齐。

## 6. 验证命令和实际结果

完整输出摘录见 [evidence.txt](audits/membership-2026-09-20/evidence.txt)。空输出的 `go build` / `go vet` 退出码均为 0。

| 执行命令 | 实际结果 |
|---|---|
| `cd apps/api; go build ./...` | exit 0 |
| `cd apps/api; go vet ./...` | exit 0 |
| `cd apps/api; go test ./...` | exit 0，部分已有测试命中缓存 |
| `pnpm --filter ai-manhua-studio check` | exit 0 |
| `pnpm --filter ai-manhua-studio test` | `Test Files 150 passed (150); Tests 889 passed (889)` |
| `pnpm --filter ai-manhua-studio build` | exit 0，`built in 3.23s` |
| `pnpm --filter @basketikun/canvas-agent test` | tests 4 / pass 4 / fail 0 |
| `pnpm --filter @ai-manju/director-desk test` | Test Files 87 passed; Tests 686 passed |
| `cd apps/worker; python -m compileall worker` | 宿主机 exit 0 |
| `cd apps/worker; python -m unittest discover -s tests` | 宿主机失败：当前 Python 缺 `billiard` 等 Worker 依赖；不是业务失败结论 |
| 在已有 `studio-beta-worker:20260911` 镜像中只读挂载当前 Worker 源码，执行上述两条 Python 命令 | `Ran 80 tests in 0.454s; OK (skipped=1)`，exit 0；并非新构建的发布镜像验收 |
| 设置临时 `TEST_DATABASE_URL` 后 `go test -count=1 -v ./internal/repository -run TestGormCreditRepositorySemantics` | 11 个子用例通过，含 FEFO、冻结、结算幂等、退款扣账基础语义、并发不超扣 |
| 同时设置临时 `TEST_DATABASE_URL` / `ASSET_TEST_DATABASE_URL` 后 `go test -count=1 -timeout=180s ./internal/repository` | `ok github.com/ai-manju/api/internal/repository 6.379s` |
| 本轮核心探针 `run-audit.ps1 -Area Core`，Memory + PostgreSQL | 12 个失败子用例，对应 B1–B6 |
| 本轮真实后台路由探针 `run-audit.ps1 -Area Admin`，Memory + PostgreSQL | 5 个通过、8 个失败、1 个跳过；失败对应 A1 两个场景、A2、A3 |

原有测试通过与新增探针失败并不冲突：原有覆盖缺少这些业务边界。本轮没有把有问题的行为写成“应该通过”的测试。

## 7. 复现方法

附件：

- [run-audit.ps1](audits/membership-2026-09-20/run-audit.ps1)：通过 Go overlay 加载探针，不修改正常测试目录。
- [audit_test.go.txt](audits/membership-2026-09-20/audit_test.go.txt)：会员/积分边界场景，默认不运行支付待办。
- [admin_audit_test.go.txt](audits/membership-2026-09-20/admin_audit_test.go.txt)：完整路由、登录、权限与数据读写。

**仅对一次性测试数据库运行**。探针会创建数据并编辑测试默认套餐，不能指向现有业务库。建议新建空 PostgreSQL 容器；数据库 URL 不写入仓库。后台探针额外创建独立 schema。

```powershell
# 不传数据库时仅测 Memory。
pwsh -File docs/audits/membership-2026-09-20/run-audit.ps1 -Area Core
pwsh -File docs/audits/membership-2026-09-20/run-audit.ps1 -Area Admin

# AUDIT_DATABASE_URL 指向一次性 PostgreSQL 数据库时，两套实现都测。
# URI 示例格式：postgres://USER:PASSWORD@127.0.0.1:PORT/AUDIT_DB?sslmode=disable
# 在本机安全设置环境变量，再执行同样的命令。
```

受审代码下 exit 1 是预期的缺陷证据，修复后应将对应场景纳入正常测试并获得 exit 0。未接真实渠道时不运行 `-IncludePayment`。

## 8. 上云准备的放行条件

本轮没有修改云环境或启用新服务。当前应先关闭 A1–A3、B1–B6，之后再冻结候选版本并执行以下准备：

1. 在同一提交/工作树快照上重跑验收，创建带摘要的 API/Web/Worker 镜像，记录镜像与迁移版本。当前并行编辑中的工作区不能直接当发布候选。
2. `deploy/cloud/studio.runtime.env.example` 目前没有显式登记 `BILLING_ENABLED`，代码默认 false；修复验收后应明确是否启用计费、对账与调度，不能依赖本地 compose 的 true 默认值。
3. 非支付测试环境使用受控运营发放/兑换机制；生产配置继续禁止 mock 支付。支付暂缓期间定义好会员操作入口，避免必须改数据库才能服务用户。
4. 复核默认套餐权益和真实模型计费规则。当前定价器仍按粗粒度图片尺寸、视频 fast/standard 计价；详细模型价表的最终采用范围需要单独核对，不能把参考表提取完成等同于计价引擎已覆盖。模型接入配置本轮不复测。
5. 明确迁移身份与运行身份；验证账本/审计表的实际权限，落实备份、恢复演练和回滚。已产生计费数据后不直接通过降级删除新表。
6. 复用现有 `deploy/cloud` 的 TLS、私网数据库/Redis、存储、备份和发布检查工具；完成实际环境参数核对。监控需覆盖冻结积压、结算失败、过期清理失败与审计写入失败。
7. 在预发布环境用实际 UI 点击完成用户管理、调账、会员发放、配置修改、重启保持和审计查询；本轮主要是源码和真实 HTTP 路由验收，没有声称完成全部浏览器交互验收。

## 9. 支付相关待办 不计入本轮渠道阻塞

此前探针已观察到三项代码问题，留待接支付时修复并验收：支付状态先变 paid 后履约失败，重试不会补发；未付款订单也可触发退款扣积分；退款按修改后的积分包数量扣回，未保留购买时的权益快照。相关探针通过 `-IncludePayment` 显式启用。本轮不接商户渠道、不调整支付方案。
