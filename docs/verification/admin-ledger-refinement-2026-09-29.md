# 积分流水筛选与呈现补充验收

## 修改范围

针对“积分流水感觉没有明显变化”的反馈，进一步调整积分流水的实际查询操作和信息层次。上一轮三个页面的公共样式继续保留；本轮不再改运营看板、消耗与成本、运行监控，也不修改后台外层导航、主标题和右侧状态栏。

积分流水原来位于面板标题旁的时间、类型控件移入内容区，与用户查询集中排列。标题和刷新入口保留。此安排替代上一份验收说明中“类型、时间保留原位”的描述。

## 交付行为

- 四个带标签的筛选项：时间范围、流水类型、搜索用户、用户范围；查询与重置集中在同一区域。
- 使用现有 `/api/admin/member-users` 查询真实用户，支持昵称、账号、用户 ID，选择后向流水接口传实际用户 ID。同名用户用账号区分；搜索结果限制每次 20 位并提示缩小范围，不把首次返回的用户当作全部用户。
- 搜索等待、失败重试、未匹配、未选择均有反馈。输入关键词但未选择用户时阻止查询，避免意外查询全部用户。
- 时间支持原有快捷选项和自定义起止日期。日期包含本地时区的开始及结束当天；结束参数保留当天最后一秒的纳秒精度。开始晚于结束、缺少日期时在提交前提示。
- 筛选编辑与已生效查询分离；组合条件点击查询后统一生效并回到第一页。展示当前已生效条件，未提交的修改有提示。翻页固定使用已提交的时间边界。
- 切换条件等待时，不把上一组结果或统计显示为新条件的数据。刷新、分页、错误重试继续可用。
- 统计为匹配总条数、本页增加、本页扣减、本页净变动。没有将本页金额包装为全量金额。
- 明细保留原有七列，补充实际已获取的用户昵称、流水编号、订单/任务区分。未获取昵称时保留原用户 ID。
- 修正限时积分流水误显示永久积分余额的问题：限时读取 `grant_remaining_after`，标注“该批次剩余”；永久读取 `permanent_after`；字段缺失显示“—”。
- 控件自适应换行，宽表格在内容区内滚动。查看了桌面、自定义日期和窄屏截图。

本轮不改接口、权限及两套仓库；已核对 Memory/Gorm 对日期均使用包含式边界，用户搜索在服务端过滤后分页。

## 实际验证结果

日志目录：`.tmp/admin-ledger-refinement-20260929/`。

Studio `check` 退出码 0；测试及构建输出：

```text
Test Files  257 passed (257)
     Tests  2031 passed (2031)
✓ built in 6.51s
```

新增 10 项回归检查，覆盖原子提交、分页重置、翻页时间边界、未选择用户阻断、旧数据隐藏、日期校验、余额快照、搜索失败重试及相同条件刷新。构建仍有既有的部分包超过 500 kB 提示。

浏览器验证实际输出：

```text
ok 1 ledger consolidates filters and applies actual user/type/time parameters together (2.3s)
ok 2 ledger validates custom dates and unresolved user searches before requesting (2.2s)
ok 3 dashboard filters existing metrics without falsifying aggregate requests (1.7s)
ok 4 usage filters and export keep the selected API query (1.8s)
ok 5 all three content areas wrap filters and confine table overflow (4.2s)
5 passed (12.9s)
```

浏览器使用明确的测试响应验证交互、真实请求参数及 1920/1440/390px 布局；不将夹具数据视为线上账务结果。截图位于 `.tmp/admin-report-layout-20260929/browser/`。

项目要求的其他检查：

```text
API: go build ./... / go vet ./... / go test ./... 均退出码 0（test 为 cached）
Canvas Agent: tests 4, pass 4, fail 0
Director Desk: Test Files 87 passed (87), Tests 689 passed (689)
Worker: Ran 275 tests in 8.285s; OK (skipped=27)
```

Worker 同时执行 `python -m compileall -q worker`，通过；27 项按已有环境条件跳过。`git diff --check` 通过。

## 状态

本地修改完成，未提交、未部署线上。之前运行监控的采集与详情修复保持原样。
