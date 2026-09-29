# 后台三个页面内容排布验收

后续积分流水改进见 [积分流水补充验收](admin-ledger-refinement-2026-09-29.md)：类型、时间筛选已集中移入内容区，并增加用户查找、自定义日期、重置和已生效条件提示。下文记录第一轮结果。

## 修改范围

运营看板、积分流水、消耗与成本参照运行监控调整内容区：带标签的筛选栏、横向统计、列表标题、表格和分页。新增样式全部限定在 `admin-report-content` 内。

没有修改管理后台外层布局、左侧导航、顶部标题、右侧信息栏。积分流水红框外原有的流水类型、时间范围和刷新按钮保留原位。之前的运行监控修复保持原样。

- 筛选控件统一为 36px 高度、12px 间距、标签在上；按可用宽度换行。
- 统计使用分隔线和横向数字排列，保留原来的统计口径和金额格式。
- 积分流水改为语义化表格，保留全部七列、原查询参数和分页；宽表在内容区内部滚动。
- 运营看板新增指标分类、统计口径和关键词筛选。筛选的是既有七项真实汇总指标的显示，不新增未经后端支持的任意时间/用户汇总查询。
- 消耗与成本保留现有成员、日期、项目、任务、模型、供应商、状态、成员类型筛选；保持分组、明细、费用核对、单价、导出和详情。补充成员选择的明确无障碍名称。
- 数据加载失败/等待期间，流水统计显示“—”，不显示虚构的零值。

本次业务源码修改仅限三个面板及新增局部 CSS；没有修改接口、数据计算、权限或后台任务。

## 验证

日志与截图：`.tmp/admin-report-layout-20260929/`。

Studio 最终检查：`check` 退出码 0。

```text
Test Files  255 passed (255)
     Tests  2021 passed (2021)
✓ built in 8.96s
```

保留已有大于 500 kB 的构建包体提示。

浏览器验证：

```text
ok ledger keeps outside controls and sends real user/type/time filters
ok dashboard filters existing metrics without falsifying aggregate requests
ok usage filters and export keep the selected API query
ok all three content areas wrap filters and confine table overflow
4 passed (40.3s)
```

覆盖流水用户/类型/时间参数、看板实际数值与指标过滤、消耗筛选和导出参数一致，以及 1920/1440/390px 布局。截图已查看，外部结构保留，表格宽度限制在内容区。界面使用明确测试响应，没有读取或写入用户生成任务、账单和资产数据，不把这些截图当作线上数据证据。

测试调试期间修正了夹具对 Vite 源文件请求的误拦截、既有金额格式的错误断言，并补齐成员下拉框的无障碍名称；最终四项通过。

按项目要求另外执行了未修改模块的检查：

```text
API: go build ./... / go vet ./... / go test ./... 均退出码 0
Canvas Agent: tests 4, pass 4, fail 0
Director Desk: Test Files 87 passed (87), Tests 689 passed (689)
Worker: Ran 275 tests in 7.453s; OK (skipped=27)
```

Worker 同时执行 `python -m compileall -q worker`，退出码 0；27 项继续按原有环境条件跳过。`git diff --check` 无错误。

## 交付状态

本地代码已修改并验证，尚未发布线上。此次界面调整只需更新前端；之前运行监控采集功能所需的后端更新仍按对应报告执行。
