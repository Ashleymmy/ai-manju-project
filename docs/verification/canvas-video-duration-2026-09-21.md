# 画布视频时长能力与提交一致性（2026-09-21）

## 修复内容

此前画布和视频工作台按协议套用统一时长：所有 Seedance 显示 4–30 秒，其他模型显示固定档位并在提交时截到 20 秒。中间刻度显示当前选择值，位置与时长不对应。

本次 `/api/ai/models` 新增 `video_model_durations`，以完整供应商模型标识作为键；API 信封、路由、鉴权不变。SD-video 目录中已有的 `durations` 现在原样保留为合法选项，实时配置中的离散档位不会被扩成连续区间。对原生可识别 Seedance 模型 ID，后端集中维护已核实的官方能力，前端只消费目录中的数据。

- Seedance 2.5：4–30 秒及自动；2.0 系列：4–15 秒及自动；1.5 Pro：4–12 秒及自动；1.0 Pro / Pro Fast：2–12 秒。
- 中间刻度固定为最大值的一半；滑条通过两段映射将该值对应到物理中点。30 秒模型中点为 15 秒；15 秒模型中点标 7.5 秒，但 duration 接口仅接受整数，因此选择吸附到 8 秒，当前选择值独立显示。
- 固定或少量离散时长显示真实选项（例如仅 5 / 10 秒），不制造中间时长。自动按钮只在目录明确包含 `-1` 时显示。
- 切换模型或恢复历史配置时统一校正到合法值；提交阶段对已知能力严格检查，避免目录更新后悄悄改成其他秒数。原生服务端对已知范围进行入队前校验；请求中的合法秒数不再被通用 20 / 30 秒上限截断。
- 不通过可编辑名称推测不透明 `ep-*` 的模型版本，也不向其他供应商借用能力。未取得可靠范围的模型显示“该模型未提供时长范围，请按模型说明填写”，保留手动输入，不显示猜测的上限。因此未声称已确认旧 Wan 2.1、原生 Lite 或不透明端点的最大时长。

没有仓库实现或存储结构变更；Memory/Gorm 共用相同目录处理逻辑。保留其他助理修改，未提交或部署，未重启共享服务。

## 数据来源和边界

2026-09-21 核对官方文档：

- https://www.volcengine.com/docs/82379/1520757 （现跳转 Ark 创建视频任务文档）
- https://docs.byteplus.com/en/docs/ModelArk/1520757
- SD-video 运行时模型目录 `ModelConfigStore.list()` / `public_model()` 返回的 `durations`。

文档快照在 `.tmp/canvas-video-duration-qa/ark-doc.txt`、`byteplus-video.txt`。文档中的 Seedance 2.5 视频编辑任务只支持自动时长，与普通视频生成不同；当前画布没有显式编辑任务类型，本次按普通生成能力呈现，没有把参考视频长度当作输出上限。

本次验证了界面、目录映射、生成请求与服务端入队约束，使用模拟供应商/浏览器数据，没有调用付费视频生成，也没有验证线上供应商产物的最终实际时长。

## 浏览器验收

独立端口 4178，Chrome。新增可复用验收 `apps/studio/e2e/canvas-video-duration.spec.ts`：真实操作画布参数，检查 30 秒模型中点选择 15 秒、切到 15 秒模型后上限和当前值同步收窄、中点刻度 7.5 秒吸附为 8 秒；记录真实前端提交请求，确认 `duration: 8`。再切换 5 / 10 秒模型，确认没有自动按钮、不显示不支持的滑条秒数且提交 `duration: 10`；未知模型显示能力缺失提示。无页面运行时异常。

```text
1 passed (6.4s)
```

截图人工检查通过：`.tmp/canvas-video-duration-qa/browser/` 中 `duration-30.png` 与 `duration-15.png`。首次脚本在模拟失败后继续查找“生成”按钮，实际按钮已变为“重试”；按实际状态调整定位后通过，产品无须改动。

## 项目规定检查实际输出

```text
pnpm --filter ai-manhua-studio check
$ tsc --noEmit
exit 0

pnpm --filter ai-manhua-studio test -- [指定文件]
# 当前 pnpm 脚本转发实际运行完整 Studio 套件
Test Files 190 passed (190)
Tests 1193 passed (1193)
Duration 10.17s

pnpm --filter ai-manhua-studio build
✓ built in 3.37s
exit 0

go build ./...
exit 0
go vet ./...
exit 0
go test ./...
ok github.com/ai-manju/api/internal/handler 16.645s
ok github.com/ai-manju/api/internal/router 1.513s
exit 0

pnpm --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)

python -m compileall -q worker && python -m unittest discover -s tests
Ran 92 tests in 1.616s
OK (skipped=1)

git diff --check
exit 0
```

日志在 `.tmp/canvas-video-duration-qa/`。Go 使用已有本地工具链；Worker 使用已有独立测试容器、只读挂载源码，未配置 Redis 的测试跳过。初次类型检查发现兼容导出仍被引用，保留兼容导出并调整参数控件测试后检查通过。pnpm 自动移除的原锁文件 override 精确补回，无依赖变更。
