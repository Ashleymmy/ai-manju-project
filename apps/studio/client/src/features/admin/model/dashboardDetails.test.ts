import { expect, it } from "vitest";

import {
  dashboardConsumptionRow,
  dashboardOrderRow,
  dashboardUserRow,
} from "./dashboardDetails";
import type {
  AdminConsumption,
  AdminMemberUser,
  AdminOrder,
} from "./memberAdmin";

it("preserves actual user identity, balances, and missing login", () => {
  const row = dashboardUserRow({
    user_id: "user-1",
    username: "account",
    display_name: "用户",
    status: "active",
    permanent_balance: 0,
    limited_balance: 12,
    total_recharge_cents: 1990,
  } as AdminMemberUser);
  expect(Object.fromEntries(row.fields)).toMatchObject({
    "用户 ID": "user-1",
    永久积分: "0",
    限时积分: "12",
    累计充值: "¥19.90",
    最近登录: "—",
  });
});

it("keeps an unpaid order distinct from paid revenue and retains identifiers", () => {
  const row = dashboardOrderRow({
    id: "order-1",
    user_id: "user-1",
    amount_cents: 2900,
    status: "pending",
    order_type: "credit_pack",
    created_at: "2026-09-29T00:00:00Z",
  } as AdminOrder);
  expect(Object.fromEntries(row.fields)).toMatchObject({
    订单编号: "order-1",
    订单金额: "¥29.00",
    订单状态: "待支付",
    支付时间: "—",
  });
});

it("does not fabricate settlement amounts or infer generation success from credit release", () => {
  const item = {
    id: "consumption-1",
    user_id: "user-1",
    job_id: "job-1",
    task_type: "image",
    model: "model-real",
    credits_quoted: 15,
    credits_settled: null,
    status: "released",
    created_at: "2026-09-29T00:00:00Z",
    params: { aspect_ratio: "1:1", text: "<script>test</script>" },
  } as AdminConsumption;
  const row = dashboardConsumptionRow(item);
  expect(Object.fromEntries(row.fields)).toMatchObject({
    积分状态: "已释放",
    实扣积分: "—",
    模型: "model-real",
    任务编号: "job-1",
  });
  expect(JSON.parse(row.parameters!)).toEqual(item.params);
  expect(
    Object.fromEntries(
      dashboardConsumptionRow({ ...item, credits_settled: 0 }).fields
    )["实扣积分"]
  ).toBe("0");
});
