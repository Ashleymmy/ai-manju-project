# WP-M1 + WP-M2 实现方案：会员/积分数据模型与账本引擎

> 上游文档：`MEMBERSHIP-SYSTEM-GAP-ASSESSMENT.md`（差距/工单）、`MEMBERSHIP-SYSTEM-PRICING-DATA.md`（已定稿定价）、`MEMBERSHIP-SYSTEM-TAPNOW-UI-MAPPING.md`（UI 映射）
> 已定稿前提：**2 个付费档（¥198 / ¥1980）、新用户赠 1000、数据可配不硬编码、双余额 + 限时优先扣 + 成功才扣费**
> 硬约束：不改响应信封 / 路由 / 鉴权语义；Memory 与 Gorm 两套仓储行为一致；常量集中带注释；先保证不丢数据、不卡死

---

## 0. 范围

| 工单 | 本方案覆盖 | 不覆盖（后续工单） |
|---|---|---|
| **WP-M1** | 11 张表的 GORM 模型 + AutoMigrate 注册 + 仓储接口与双实现 | 管理端/用户端 API 路由（WP-M7/M10） |
| **WP-M2** | `CreditLedgerService` 账本引擎：reserve / settle / release / grant / expire / adjust / refund | 与 Job 生命周期的接线（WP-M3）、过期调度器（WP-M4，本方案只设计引擎接口） |

**本阶段零路由变更、零前端变更**，所有行为经 service 单测验证。

---

## 1. 核心建模决策

### 1.1 限时积分 = 批次（grant），不是一个数字

会员每月发放、注册赠送、邀请奖励、活动赠送的积分**各有自己的有效期**（31 天 / 可配置 / 30 天 / 自定义），所以限时余额必须建模为**批次集合**：

```
credit_accounts   每用户一行：永久积分余额 + 冻结
credit_grants     每批限时积分一行：总额 / 剩余 / 冻结 / 过期时间
```

用户可见的「限时积分余额」= `Σ(grant.remaining - grant.frozen)`（未过期批次）。

### 1.2 扣减顺序 = FEFO（先过期先扣）

文档规则「优先扣除限时积分，耗尽后扣永久积分」落地为：

1. 未过期批次按 `expires_at ASC` 排序，**先扣快过期的**（FEFO）
2. 限时批次耗尽后才动永久积分

### 1.3 冻结（reserve）是「成功才扣费」的前提

任务提交时**冻结**而非扣减；终态结算（settle）才真正扣；失败/取消/超时释放（release）。**冻结时刻的分配快照**存在 `task_consumptions.allocation`（JSONB），结算时按快照结转，**绝不重读余额**——这样即使批次在任务运行中过期，在途任务不受影响。

### 1.4 过期不清冻结部分

批次过期时只清零 `remaining - frozen` 的**可用部分**；冻结部分留给在途任务：
- settle → 正常从冻结转出（用户已占用，不因过期受损）
- release → 冻结退回一个已过期且 remaining=0 的批次，**自然消失，不产生流水**（从未扣费）

### 1.5 退款负余额策略

退款回滚时若积分已被消耗：**允许永久余额为负**，负余额期间禁止新的 reserve（可用量恒为 0），后续充值自然冲抵。每笔负余额变动照常记流水，对账可查。

> 备选方案（clamp + 债务表）复杂度更高且语义相同，不采用。如运营要求「不允许负余额」，改 `Refund` 一处即可。

### 1.6 金额与精度

- 积分：`int64`（整数积分，无小数）
- 金额：`int64` 分（cents），展示层格式化
- 折扣：`int` 基点（bps），8000 = 8 折；恒定换算 `CreditsPerYuan = 100` 放常量区（可调通过 `billing_configs`）

---

## 2. 表结构（WP-M1）

新增文件 `apps/api/internal/model/membership.go`（会员/套餐）、`model/credit.go`（账户/批次/流水/消耗）、`model/billing.go`（直购套餐/订单/配置）、`model/invite.go`（邀请）、`model/audit.go`（审计）。常量全部集中在对应文件顶部并带注释。

### 2.1 `membership_plans` 会员套餐

```go
type MembershipPlan struct {
    ID               string    `gorm:"primaryKey"`              // e.g. "plan_member_198"
    Code             string    `gorm:"uniqueIndex;not null"`    // "member_198" / "member_1980"
    Name             string    `gorm:"not null"`                // 展示名
    PriceMonthCents  int64     `gorm:"not null"`                // 19800 / 198000
    PriceYearCents   int64     `gorm:"not null;default:0"`      // 0 = 未开通年付
    MonthlyCredits   int64     `gorm:"not null"`                // 每月赠送积分（198 档种子 19800）
    ImageConcurrency int       `gorm:"not null;default:2"`
    VideoConcurrency int       `gorm:"not null;default:1"`
    CreditDiscountBps int      `gorm:"not null;default:10000"`  // 购积分折扣，10000=无折扣
    PriorityRank     int       `gorm:"not null;default:0"`      // 排队优先级，大者靠前
    Features         JSONB     `gorm:"type:jsonb"`              // {"remove_watermark":true,"commercial":true,"agent_free":true,...}
    Enabled          bool      `gorm:"not null;default:true"`
    CreatedAt, UpdatedAt time.Time
}
```

种子数据（`STORAGE_DRIVER=postgres` 启动时 upsert，幂等键 = Code）：`member_198`（¥198/月，19,800 积分）、`member_1980`（¥1980/月，权益待运营录入，先给占位值）。**只插这两档**；4 档草案不进库。

### 2.2 `user_memberships` 用户会员

```go
type UserMembership struct {
    ID         string     `gorm:"primaryKey"`
    UserID     string     `gorm:"not null;index:idx_membership_user_active,unique"` // 同一用户最多一条 active（部分唯一索引见下）
    PlanID     string     `gorm:"not null;index"`
    Status     string     `gorm:"not null;index"`        // active / expired / revoked(退款)
    Source     string     `gorm:"not null"`              // purchase / admin / redeem / campaign
    OrderID    string     `gorm:"index"`                 // 来源订单（可空）
    StartedAt  time.Time  `gorm:"not null"`
    ExpiresAt  time.Time  `gorm:"not null;index"`        // 到期判断的唯一事实源
    CreatedAt, UpdatedAt time.Time
}
```

- **active 唯一性**：Postgres 用部分唯一索引 `WHERE status='active'`（AutoMigrate 建不了，WP-M1 在 `database.go` 迁移后补一条 `CREATE UNIQUE INDEX IF NOT EXISTS ... WHERE status='active'` 的原生 SQL，注释说明）；Memory 版在 Upsert 时同等校验
- 到期判定**不依赖定时任务**：查询时 `status='active' AND expires_at > now()` 即为有效；调度器只负责「到期清零当月赠送积分」的副作用

### 2.3 `credit_accounts` 积分账户（永久池）

```go
type CreditAccount struct {
    UserID            string    `gorm:"primaryKey"`        // 与 users.id 一对一
    PermanentBalance  int64     `gorm:"not null;default:0"`
    PermanentFrozen   int64     `gorm:"not null;default:0"`
    CreatedAt, UpdatedAt time.Time
}
```

### 2.4 `credit_grants` 限时积分批次

```go
type CreditGrant struct {
    ID             string     `gorm:"primaryKey"`
    UserID         string     `gorm:"not null;index:idx_grant_user_expiry"`
    SourceType     string     `gorm:"not null;index"`    // member_monthly / register_bonus / invite_reward / activity / admin_adjust
    AmountTotal    int64      `gorm:"not null"`
    AmountRemaining int64     `gorm:"not null"`
    AmountFrozen   int64      `gorm:"not null;default:0"`
    GrantedAt      time.Time  `gorm:"not null"`
    ExpiresAt      time.Time  `gorm:"not null;index:idx_grant_user_expiry"` // 过期扫描 + FEFO 排序都走它
    Status         string     `gorm:"not null;index"`    // active / exhausted / expired
    PeriodKey      string     `gorm:"uniqueIndex"`       // 幂等键："member_monthly:u123:2026-10" / "register:u123" / order:xxx
    RelatedID      string     `gorm:"index"`             // 订单/会员/邀请记录 id
    CreatedAt      time.Time
}
```

### 2.5 `credit_ledger` 积分流水（append-only）

```go
type CreditLedgerEntry struct {
    ID                  string    `gorm:"primaryKey"`
    UserID              string    `gorm:"not null;index:idx_ledger_user_time"`
    EntryType           string    `gorm:"not null;index"`     // 文档 7 类：recharge / member_monthly / consume / admin_add / admin_subtract / expire / activity_bonus
    Amount              int64     `gorm:"not null"`           // 有符号：增正减负
    Bucket              string    `gorm:"not null"`           // permanent / grant
    GrantID             string    `gorm:"index"`              // bucket=grant 时必填
    PermanentAfter      int64     `gorm:"not null"`           // 变动后永久余额快照
    GrantRemainingAfter int64     // bucket=grant 时的批次剩余快照
    OrderID             string    `gorm:"index"`
    JobID               string    `gorm:"index"`
    OperatorID          string    // "system" 或管理员 id
    IdempotencyKey      string    `gorm:"uniqueIndex;not null"`
    CreatedAt           time.Time `gorm:"index:idx_ledger_user_time"`
}
```

- **无 `UpdatedAt`，应用层不提供任何 Update/Delete 方法**；Postgres 侧追加 `REVOKE UPDATE, DELETE`（迁移后原生 SQL，与审计日志同批）
- `IdempotencyKey` 是唯一防线：任何重复结算/重复发放/重复过期都撞唯一索引后幂等返回

### 2.6 `task_consumptions` 任务消耗（冻结快照）

```go
type TaskConsumption struct {
    ID             string    `gorm:"primaryKey"`
    JobID          string    `gorm:"uniqueIndex;not null"`  // 幂等：一个 job 最多一条
    UserID         string    `gorm:"not null;index"`
    TaskType       string    `gorm:"not null;index"`        // image / video_fast / video_standard / agent_skill
    Model          string    `gorm:"not null"`
    Params         JSONB     `gorm:"type:jsonb"`            // {"resolution":"1024x1024","duration_sec":10,...}
    CreditsQuoted  int64     `gorm:"not null"`              // 报价（定价表算出）
    CreditsSettled int64                            // 实际扣减（settle 后写）
    Allocation     JSONB     `gorm:"type:jsonb"`            // 冻结快照：[{"bucket":"grant","grant_id":"...","amount":30},{"bucket":"permanent","amount":20}]
    Status         string    `gorm:"not null;index"`        // reserved / settled / released
    CreatedAt      time.Time
    SettledAt      *time.Time
}
```

### 2.7 `credit_packages` 直购积分套餐

`id / name / credits / price_cents / enabled / sort_order / created_at / updated_at`。种子：600/¥6、3,000/¥30、9,800/¥98、19,800/¥198、32,800/¥328、64,800/¥648（价格以分存）。

### 2.8 `orders` 订单

```go
type Order struct {
    ID             string     `gorm:"primaryKey"`
    UserID         string     `gorm:"not null;index"`
    OrderType      string     `gorm:"not null;index"`      // credit_pack / member_monthly / member_yearly
    PlanID         string     `gorm:"index"`               // 会员单
    PackageID      string     `gorm:"index"`               // 直购单
    AmountCents    int64      `gorm:"not null"`            // 实付（折扣后）
    Currency       string     `gorm:"not null;default:'CNY'"`
    PayChannel     string     // alipay / wechat / balance（余额支付）
    Status         string     `gorm:"not null;index"`      // pending / paid / refunded / closed
    InvoiceStatus  string     `gorm:"not null;default:'none'"` // ✅ 预留：none / requested / issued（第一期只展示「联系客服」）
    PaidAt         *time.Time
    RefundedAt     *time.Time
    CreatedAt, UpdatedAt time.Time
}
```

### 2.9 邀请（两张表）

```go
type InviteProfile struct { // 每用户一个邀请码
    UserID     string `gorm:"primaryKey"`
    InviteCode string `gorm:"uniqueIndex;not null"`  // 生成规则常量：8 位大写字母数字，碰撞重试
    CreatedAt, UpdatedAt time.Time
}

type InviteRecord struct {
    ID           string     `gorm:"primaryKey"`
    InviterID    string     `gorm:"not null;index"`
    InviteeID    string     `gorm:"uniqueIndex;not null"`  // 被邀请人只能被邀请一次（防刷）
    RewardStatus string     `gorm:"not null;index"`        // pending_first_recharge / granted / expired
    InviterReward int64     // 种子 2000
    InviteeReward int64     // 种子 500
    FirstChargeBonus int64  // 种子 1000（首充额外奖）
    GrantedAt    *time.Time
    CreatedAt    time.Time
}
```

奖励值**不进表结构当默认值之外的真相**——运行时从 `billing_configs` 读，表字段只是发放时的快照。

### 2.10 `admin_audit_logs` 审计日志（append-only）

`id / admin_id / action / target_type / target_id / detail JSONB / ip / created_at`。action 常量：login / refund / adjust_credits / disable_user / reset_invite_code / update_plan / update_activity。同样 `REVOKE UPDATE, DELETE`。

### 2.11 `billing_configs` 运行时配置

`key PK / value JSONB / updated_at / updated_by`。承载：新用户赠送（1000）、邀请奖励三值（2000/500/1000）、奖励有效期（30 天）、限时折扣活动（开关/起止/折扣 bps/适用模型）、定价规则页内容。**满足「定价可配，严禁硬编码」**。

### 2.12 AutoMigrate 注册

`internal/database/database.go` 的 `AutoMigrate` 列表追加 11 个模型；紧随其后执行两条原生 SQL（部分唯一索引 + 两张 append-only 表的 REVOKE），带注释说明为何 AutoMigrate 表达不了。Memory 模式不执行 SQL，由仓储构造器保证同等语义。

---

## 3. 仓储层（WP-M1）

| 文件 | 接口 | 说明 |
|---|---|---|
| `repository/membership_repository.go` | `MembershipRepository` | plans CRUD + `GetActiveMembership(userID)` + `ExpireMembershipsBefore(now)` |
| `repository/credit_repository.go` + `credit_repository_gorm.go` | `CreditRepository` | 账户/批次/流水/消耗；**事务型方法**（见 §4.2） |
| `repository/billing_repository.go` | `BillingRepository` | packages + orders + billing_configs |
| `repository/invite_repository.go` | `InviteRepository` | profile + records |
| `repository/audit_repository.go` | `AuditRepository` | append + list（无 update/delete 方法） |

- Memory 实现与接口同文件（沿用 `user_repository.go` 惯例）；Gorm 实现重的拆 `*_gorm.go`（沿用 `tag_repository_gorm.go` 惯例）
- **双实现一致性**：同一套语义测试套件跑两遍（Memory + 可选 Postgres），测试组织沿用 `asset_repository_test.go` / `asset_folder_postgres_test.go` 的分层

---

## 4. 账本引擎（WP-M2）

新文件 `internal/service/credit_ledger_service.go`。常量集中文件顶部：流水类型、消耗状态、批次来源、`CreditsPerYuan = 100` 等，全部带注释。

### 4.1 接口

```go
type CreditLedgerService struct { /* repos */ }

// 任务生命周期（WP-M3 接线点）
func (s *CreditLedgerService) Reserve(userID string, quote CreditQuote) (model.TaskConsumption, error)
func (s *CreditLedgerService) Settle(jobID string) error   // 幂等：非 reserved 直接返回 nil
func (s *CreditLedgerService) Release(jobID string) error  // 幂等同上

// 发放与过期（WP-M4 调度器调用）
func (s *CreditLedgerService) Grant(input GrantInput) (model.CreditGrant, error) // PeriodKey 幂等
func (s *CreditLedgerService) ExpireGrantsBefore(now time.Time, limit int) (int, error)
func (s *CreditLedgerService) ExpireMembershipGrants(membershipID string) error  // 会员到期清当月

// 管理与对账
func (s *CreditLedgerService) Adjust(userID string, amount int64, operatorID string, reason string, nonce string) error
func (s *CreditLedgerService) RefundOrder(orderID string, operatorID string) error
func (s *CreditLedgerService) Overview(userID string) (CreditOverview, error) // 双余额 + 最近到期批次

type CreditQuote struct { // 报价由定价表（billing_configs）计算，引擎不感知定价
    JobID, TaskType, Model string
    Params  map[string]any
    Credits int64
}
```

错误常量：`ErrInsufficientCredits` / `ErrConsumptionNotFound` / `ErrConsumptionTerminal` / `ErrDuplicateGrant` / `ErrOrderNotRefundable`。

### 4.2 事务与锁顺序

**Reserve**（单事务）：

```
1. SELECT credit_accounts WHERE user_id FOR UPDATE          -- 锁账户行
2. SELECT credit_grants WHERE user_id AND status='active'
     AND expires_at > now ORDER BY expires_at ASC, id ASC
     FOR UPDATE                                              -- 固定锁顺序防死锁
3. available = Σ(remaining - frozen) + (permanent_balance - permanent_frozen)
   if available < quote.Credits → ErrInsufficientCredits
4. 按 FEFO 在批次上累加 frozen，溢出部分加到 permanent_frozen
5. INSERT task_consumptions（status=reserved, allocation=快照）
   -- job_id 唯一索引：重复提交撞索引 → 返回已有记录（幂等）
6. 提交
```

**Settle**（单事务）：按 `allocation` 快照逐条 `frozen -= x; remaining -= x`（批次）/ `frozen -= x; balance -= x`（永久）；写流水（type=consume，每桶一条，带余额快照）；状态 → settled。**不查余额、不重算价格**。

**Release**（单事务）：按快照逐条 `frozen -= x`（remaining 不动）；状态 → released；**不写流水**（无积分变动；「未扣费」由 consumption 记录表达）。

**Grant**（单事务）：`PeriodKey` 撞唯一索引 → 返回既有批次（幂等）；否则插批次 + 流水（member_monthly/register_bonus/invite/activity/admin_add）。

**ExpireGrantsBefore**（分页扫批，每批独立事务）：`deductible = remaining - frozen`；`remaining = frozen`；若 deductible > 0 写流水（type=expire，幂等键 `expire:{grant_id}`）；批次全空 → status=expired。多副本安全：调度器外层加分布式锁（WP-M4），引擎内层靠幂等键兜底，**重复执行无害**。

**RefundOrder**（单事务）：
- 直购单：`permanent_balance -= credits`（允许为负）+ 流水（type=admin_subtract 的变体 `refund_rollback`，关联 order_id）
- 会员单：membership → revoked + `ExpireMembershipGrants` 清当月批次 + 流水
- 状态守卫：仅 `paid → refunded`，其余报 `ErrOrderNotRefundable`

### 4.3 幂等矩阵

| 操作 | 幂等键 | 兜底 |
|---|---|---|
| Reserve | `task_consumptions.job_id` 唯一索引 | 撞索引返回已有 |
| Settle / Release | 状态机守卫（非 reserved 直接 nil） | 终态不可迁移 |
| 会员月发 | `period_key = member_monthly:{user}:{yyyy-MM}` | 唯一索引 |
| 注册赠送 | `period_key = register:{user}` | 唯一索引 |
| 购买发放 | `period_key = order:{order_id}` | 唯一索引 |
| 邀请奖励 | `invite_records.reward_status` 迁移守卫 + 发放 `period_key = invite:{record_id}` | 双保险 |
| 过期扣减 | `ledger.idempotency_key = expire:{grant_id}` | 唯一索引 |
| 后台调账 | 调用方 nonce（前端生成 UUID） | 唯一索引 |

### 4.4 Memory 实现语义

单 `sync.Mutex` 串行化所有引擎操作（memory 模式仅 dev/test，正确性优先于并行度）；FEFO 排序、冻结快照、幂等键行为与 Gorm 版**逐断言一致**，同一测试套件双跑。

---

## 5. 与现有代码的接线点（WP-M3 预告，本阶段只留接口）

| 时机 | 现有位置 | 动作 |
|---|---|---|
| 任务提交 | `JobService.Enqueue` / `aiHandler.ImageGenerations` / `VideoTaskCreate` | 先 `Reserve`，余额不足返回 402 语义错误（信封不变，HTTP 状态用 200 系 + error 或 402——**WP-M3 定**，本方案不预设） |
| 任务成功 | `JobService.SetResult` | 成功后 `Settle(jobID)` |
| 任务失败/取消 | `JobService.SetError` / `CancelForUser` / worker 回写 failed/canceled | `Release(jobID)` |
| 注册 | `authHandler.Register` | `Grant(register_bonus, 1000)`，配置驱动 |
| 文本生成 | `aiHandler.Text` | 免费，不接账本 |

`JobService` 增加可选注入 `SetCreditSettler(...)`（沿用现有 `SetAssetUsageRecorder` 的 setter 注入惯例），WP-M1/2 阶段不接。

---

## 6. 边界场景处理

| 场景 | 行为 |
|---|---|
| 批次在任务运行中过期 | settle 按冻结快照正常结转，用户不受损 |
| 任务在批次过期后失败 | release 冻结退回已过期批次，自然消失，无流水 |
| 会员到期但有在途任务 | 到期只清「可用赠送积分」；在途冻结正常结算 |
| 退款时积分已花光 | 永久余额转负，reserve 恒失败直到冲抵，流水可查 |
| 调度器多副本并发过期 | 幂等键 `expire:{grant_id}`，重复执行无害 |
| 并发提交同一余额 | 账户行锁 + 批次固定序锁，不超扣 |
| Memory 模式「过期」 | 引擎方法可手动调用；调度由 WP-M4 决定（memory 模式可不跑后台循环） |
| 时钟 | 一律 UTC 存储；「31 天」= `granted_at + 31*24h`（文档口径是 31 天而非自然月） |

---

## 7. 测试计划

单测（`internal/service/credit_ledger_service_test.go` + 仓储双实现套件）覆盖：

1. FEFO：两个批次不同过期时间，先扣快过期批次
2. 限时耗尽后自动扣永久
3. 并发 Reserve 不超扣（goroutine 并发 + Postgres `pgx` 竞态双验）
4. Settle/Release 幂等（重复调用结果一致）
5. 批次过期不清冻结；过期后 settle 正常、release 静默消失
6. 会员到期：当月赠送清零 + 永久不动 + 在途任务正常结算
7. 退款：已花光 → 负余额 → 后续 reserve 被拒 → 充值后恢复
8. 月发幂等：同周期重复 Grant 只发一次
9. 流水快照：每条流水 `*After` 字段与账户实际一致（对账不变量）
10. Memory / Gorm 行为一致性（同套件双跑）

交付前必跑（AGENTS.md §3）：`cd apps/api && go build ./... && go vet ./... && go test ./...`，报告贴实际输出。

---

## 8. 交付清单

```
apps/api/internal/model/membership.go      # 套餐 + 用户会员 + 常量
apps/api/internal/model/credit.go          # 账户/批次/流水/消耗 + 常量
apps/api/internal/model/billing.go         # 直购套餐/订单/配置 + 常量
apps/api/internal/model/invite.go          # 邀请 + 常量
apps/api/internal/model/audit.go           # 审计 + 常量
apps/api/internal/database/database.go     # AutoMigrate + 2 条原生 SQL
apps/api/internal/repository/{membership,credit,credit_gorm,billing,invite,audit}_repository.go
apps/api/internal/service/credit_ledger_service.go
apps/api/internal/service/credit_ledger_service_test.go
apps/api/internal/repository/credit_repository_test.go   # Memory/Gorm 双跑
```

**不变更**：`router.go`、响应信封、任何现有 handler 行为。
