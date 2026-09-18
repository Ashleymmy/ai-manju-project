# 会员系统实施状态总览

> 最后更新：2026-09-18。权威来源：`MEMBERSHIP-SYSTEM-GAP-ASSESSMENT.md`（差距/工单状态）、
> `MEMBERSHIP-SYSTEM-PRICING-DATA.md`（定价数据）、`MEMBERSHIP-SYSTEM-TAPNOW-UI-MAPPING.md`（UI 映射）、
> `MEMBERSHIP-SYSTEM-WP-M1-M2-DESIGN.md`（账本设计）、`MEMBERSHIP-SYSTEM-WP-M7-API-CONTRACT.md`（后台 API 契约）。

## 已上线代码（验收全绿）

### 后端（apps/api，`go build/vet/test ./...` 全绿）

| 层 | 内容 |
|---|---|
| 模型 | 12 张新表：membership_plans / user_memberships / credit_accounts / credit_grants / credit_ledger_entries / task_consumptions / credit_packages / orders / invite_profiles / invite_records / admin_audit_logs / billing_configs / redemption_codes / redemption_records（AutoMigrate + 部分唯一索引 + 流水/审计 REVOKE） |
| 引擎 | `CreditLedgerService`：reserve/settle/release/grant/expire/adjust/refund/recharge，FEFO 限时优先扣，冻结快照结算，幂等矩阵 |
| 接线 | `BILLING_ENABLED`（默认关）：Enqueue 前冻结、取消/失败退还、孤儿冻结宽限期回收、注册赠 1000 |
| 对账 | `CreditReconciler`（15s）：worker 直写 Postgres 终态 → 结算/退还 |
| 调度 | `CreditScheduler`（60s）：30 天周年周期月发、会员到期清扫、积分过期清零；Postgres advisory lock + 幂等键双层防重 |
| 权益 | `EntitlementGate`：准入侧并发门禁（免费 2图/1视频，会员按套餐）、非会员视频强制水印、Agent 模式仅会员 |
| 权限 | 三级后台（super/ops/auditor 只读）+ 审计中间件（写操作留痕、敏感字段脱敏）+ 管理员登录留痕 |
| 支付 | 渠道抽象 + mock 渠道（非生产）；下单/守卫状态机/履约/退款回滚；会员购积分折扣生效 |
| 邀请 | 注册绑定（无效码 400 不建号）、被邀请人即时 500、邀请人首充触发 2000+1000、防刷唯一约束 |
| 兑换码 | 积分码 + 会员天数码（学费赠会员载体）、原子核销、后台建码 |
| 配置 | billing_configs 运行时可配：注册赠送/邀请奖励/活动折扣/定价规则（含展示行）/礼包货架 |

### 前端（apps/studio，`check/test/build` 全绿，670 用例）

| 路由 | 页面 |
|---|---|
| `/member` | 会员首页（等级/双余额/限时优先扣提示/本月消耗/快速入口） |
| `/member/plans` | 套餐购买（月付/年付 tab、2 付费档卡、倒计时活动横幅、滑杆+预设+实时结算卡、动态汇率文案） |
| `/member/usage` | 消耗明细 + 积分流水双 tab（状态胶囊、4 维筛选、分页） |
| `/member/invite` | 邀请有礼（邀请码/复制链接/规则/记录/累计） |
| `/member/pricing` | 定价规则（6 条基础规则 + 三类单价表 + 套餐对比） |
| canvas 占位 chip | 「1:1」静态文案 → 定价规则页链接 |

## 待办

| 项 | 状态 |
|---|---|
| WP-M7 后台 8 模块前端面板 | 实施中（子代理） |
| 礼包超市 `/member/gifts` 页 + 账号下拉双余额 popover | 实施中（子代理） |
| WP-M13 `image4`/`image5` 单价大表人工核对 | **待人工**（OCR 无法可靠还原合并单元格表格） |
| WP-M12 账号池 + 厂商择路 | **用户决定搁置**（上线前置条件，上线前必须解决） |
| WP-M16 用量热力图 | backlog（第一期不做） |
| 支付宝/微信真实渠道 | 待商户凭证；`PaymentService.RegisterChannel` 接入点已留 |
| Gorm 语义套件实测 | 需 `TEST_DATABASE_URL`；`go test ./internal/repository/ -run Gorm` |

## 启用步骤（部署时）

1. 数据库：正常启动即 AutoMigrate（含 12 张新表 + 约束）
2. 种子：启动自动播种两档套餐（198/1980）+ 6 个积分包 + 默认配置
3. 开关：`BILLING_ENABLED=true` 启用扣费链路
4. 运营核对：后台「套餐配置」复核 1980 档权益（种子为占位值）
