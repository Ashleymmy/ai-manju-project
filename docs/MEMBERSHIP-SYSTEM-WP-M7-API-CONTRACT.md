# WP-M7 后台 API 路由契约（实施用）

> 挂在现有 `/api/admin` 组下（中间件链已含 RequireAdmin 三级权限 + AdminAudit 留痕）。
> 写操作对 auditor 由 RequireAdmin 自动 403；运营/超管放行。文档约定「运营管理员不可删除账号」——本期没有任何 DELETE user 路由，天然满足。
> 全部走统一响应信封 `{success,data,error,request_id}`。金额一律 cents；前端格式化。

## 模块1 用户会员管理
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/member-users?page=&page_size=` | AdminMemberService.ListMemberUsers；返回 `{items, total}` |
| POST | `/api/admin/member-users/:id/credits/adjust` | body `{delta, reason, nonce}`；引擎 Adjust；nonce 必填（幂等）；400 若 delta==0 或 nonce 空 |
| POST | `/api/admin/member-users/:id/invite/reset` | 重置邀请码 → inviteRepo.RegenerateInviteCode；返回新 code |

禁用账号复用现有 `PUT /api/admin/users/:id`（status 字段），不新增路由。

## 模块2 积分流水
| GET | `/api/admin/billing/ledger?user_id=&entry_type=&start=&end=&page=&page_size=` | ListLedgerGlobal；start/end RFC3339，可空 |

## 模块3 订单
| GET | `/api/admin/billing/orders?user_id=&status=&order_type=&page=&page_size=` | BillingRepository.ListOrders |
| POST | `/api/admin/billing/orders/:id/refund` | 引擎 RefundOrder；幂等；非 paid → 409 |

## 模块4 任务消耗
| GET | `/api/admin/billing/consumptions?user_id=&task_type=&status=&page=&page_size=` | ListConsumptionsGlobal；响应附带 `stats`（ConsumptionStats，user_id 空=全平台） |

## 模块5 套餐与活动配置
| GET | `/api/admin/billing/plans` | ListPlans(false) |
| PUT | `/api/admin/billing/plans/:id` | UpsertPlan（部分字段；价格/积分/并发/折扣/特权/上下架） |
| GET | `/api/admin/billing/packages?enabled_only=` | ListPackages |
| PUT | `/api/admin/billing/packages/:id` | UpsertPackage |
| GET | `/api/admin/billing/configs` | ListConfigs |
| PUT | `/api/admin/billing/configs/:key` | UpsertConfig（key 白名单：register_bonus_credits / register_bonus_ttl_days / invite_rewards / invite_reward_ttl_days / activity_discount / pricing_rules） |

## 模块6 看板
| GET | `/api/admin/billing/dashboard` | AdminMemberService.Dashboard |

## 模块7 邀请
| GET | `/api/admin/invites?page=&page_size=` | inviteRepo.ListAllRecords |

## 模块8 审计
| GET | `/api/admin/audit-logs?admin_id=&action=&page=&page_size=` | auditRepo.List |

## 导出
doc 要求导出；本期用 `?page_size=10000` 大页拉全量由前端导 CSV，不新增导出路由（记入 WP-M7 前端面板说明）。
