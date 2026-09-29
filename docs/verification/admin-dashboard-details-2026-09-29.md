# 运营看板明细表验收

## 用户要求与范围

在运营看板核心指标下方增加类似运行监控的明细表，便于管理员查看实际业务记录。

新增内容位于看板内容区下方；原七项核心指标、指标显示筛选、外部导航、页面主标题和右侧状态栏保留。没有修改积分流水、运行监控采集或其他已有业务行为。

## 已实现

增加“运营明细”，切换三种真实记录来源：

| 明细分类 | 使用的既有接口 | 主要列 |
| --- | --- | --- |
| 用户明细 | `/api/admin/member-users` | 注册时间、用户/账号、会员/状态、累计充值、积分余额、最近登录 |
| 订单明细 | `/api/admin/billing/orders` | 创建时间、用户、订单/类型、金额、状态/渠道、支付时间 |
| 消耗明细 | `/api/admin/billing/consumptions` | 创建时间、用户、任务/模型、报价/实扣积分、积分状态、结算时间 |

- 表头、两行信息、行分隔及右侧详情按钮参照运行监控。
- 每行“详情”展示后端该条记录的完整标识及对应字段；消耗记录同时显示接口返回的任务参数。字符串按文本呈现，不执行内容中的 HTML。
- 用户支持昵称、账号、ID 关键词；订单/消耗支持精确用户 ID；每类有相应状态筛选。均在服务端筛选和分页，不只过滤当前页。
- 筛选统一提交后回第一页，重置可清空条件；切换分类清理上一类条件、分页和已选详情。
- 每次仅读取当前分类。明细与汇总各自处理加载、错误、空结果，明细失败不抹去核心指标。
- 刷新运营看板同时刷新指标和当前明细。详情入口为只读，没有退款、调积分等写入操作。
- 下方明细明确标注“全部时间”及已生效条件；上方既有“统计口径/关键词”仍只筛选指标显示，未伪造后端不支持的跨业务统一日期过滤。
- 实扣积分为 null 时显示“—”，实际数值 0 显示“0”；积分的已冻结/已扣费/已释放不冒充生成任务成功或失败。

未增加后端接口或修改 Memory/Gorm。明细继续使用同一管理权限和响应信封。

## 验证结果

日志目录：`.tmp/admin-dashboard-details-20260929/`。

前端 `check` 退出码 0。实际测试和构建输出：

```text
Test Files  259 passed (259)
     Tests  2038 passed (2038)
✓ built in 9.36s
```

新增 7 项单测，覆盖分页与筛选参数、分类隔离、停用时不发请求、错误重试、原始编号/金额、未结算值、参数保留。第一次运行发现当前 Vitest 不支持使用的单条断言助手，已改成现有版本支持的次数和参数断言，最终通过。

浏览器最终实际输出：

```text
ok 1 ledger consolidates filters and applies actual user/type/time parameters together (2.5s)
ok 2 ledger validates custom dates and unresolved user searches before requesting (2.2s)
ok 3 dashboard filters existing metrics without falsifying aggregate requests (1.7s)
ok 4 dashboard business details query real endpoints, page records and open complete read-only details (2.7s)
ok 5 usage filters and export keep the selected API query (2.1s)
ok 6 all three content areas wrap filters and confine table overflow (4.2s)
6 passed (16.1s)
```

浏览器测试使用明确夹具，验证三个真实请求路径及参数、切换、分页、详情、空状态、原有页面回归，以及 1920/1440/390px 内容区排布。已查看总览与详情截图；详情截图等待入场动画完成，避免把动画中的半透明状态当作成品。

窄屏检查限定本次内容区和表格内部滚动。额外确认截图右侧空白来自既有外部导航宽度，不是新明细表溢出；按任务范围未改外部导航。

其他项目必跑检查实际结果：

```text
API: go build ./... / go vet ./... / go test ./... 均退出码 0（tests cached）
Canvas Agent: tests 4; pass 4; fail 0
Director Desk: Test Files 87 passed (87); Tests 689 passed (689)
Worker: Ran 275 tests in 9.503s; OK (skipped=27)
```

Worker 同时执行 `python -m compileall -q worker`，通过；27 项按既有环境条件跳过。前端构建保留既有大包提示，`git diff --check` 通过。

## 预览与状态

- 总览：`.tmp/admin-dashboard-details-20260929/dashboard-with-details.png`
- 详情：`.tmp/admin-dashboard-details-20260929/dashboard-consumption-detail.png`
- 截图为测试数据，不是线上运营记录。

本地修改完成，未提交、未部署线上。已有其他助手及之前工单的未提交文件保留。
