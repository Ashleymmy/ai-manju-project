# 创作积分展示与价目表部署交接

## 授权与范围

用户要求把《会员价目表.xlsx》积分放到所有生成入口附近，画布等创作界面显示可用余额，Agent 暂时显示免费；已授权验证后通知现有部署任务拉取。

用户确认：半积分同一任务汇总后向上取整；Seedance 2.0 Fast 720p 65 行按有参考视频处理；flare 4k/xhigh 按 460。用户最后两次确认保留自动参数现有行为。

## 变更

- 新增鉴权 `POST /api/member/quote`，与任务冻结共用 CreditPricer。响应信封不变。图片参数与生成接口共用规格归一化；GPT Image 2 编辑的单张限制与原提交接口一致。
- 服务端集中维护图片五种模型、Seedance/MiniMax/Wan 视频价格。参考图每张加 20；排除 mask；活动折扣之后对同一任务取整。画布/漫画的独立任务各自取整后再汇总。
- `/api/member/pricing` 附带 `model_prices`；会员定价页展示相同价目表，保留小数单价。
- 主图片/视频生成、画布面板/右键/重试/全景/扩图/多角度/蒙版、文本生图、批量创建/重试、视频历史重试接入报价。分组入口提供逐节点明细。视频重试使用原用户消息参考素材；图片重试使用保存的参考快照。
- Studio 顶栏、画布列表与画布创作页显示真实可用积分（永久可用 + 限时可用，不含冻结），每 10 秒刷新。
- Agent 对话与创作入口标注免费；图片/视频任务仍按对应模型计价。纯本地缩放/裁剪等保持免费，没有增加未实现的 AI 超分或分层功能。
- 没有改变支付、模型连接配置、数据库结构、Memory/Gorm 仓库行为。新计价在共享服务层生效。

## 已知边界（已向用户说明）

- 自动图片规格显示价目表范围；自动视频时长显示每秒单价。按用户最后确认，自动参数保留原基础扣费逻辑，没有擅自改默认参数。
- MiniMax H3、Seedance 2.5、Wan 3.0 的参考视频附加费缺少可靠的服务端参考时长，显示原表公式，实际冻结仍沿用基础规则。不能把这部分宣称为完整新表结算上线。
- 未识别模型/规格显示基础规则“预估”，不伪装成价目表准确报价。已列出的明确规格按新表冻结；旧 generic pricing_rules 继续用于其余请求，活动折扣仍生效。
- 本次没有发起真实模型或支付任务。AI 视频/图像超分未实现的模型能力不因导入价目表而新增。

## 验证

实际命令与输出摘要（完整本地日志位于 `.dsh-artifacts/credit-pricing-*.log`，不提交临时文件）：

```text
apps/api: go build ./...                           exit 0
apps/api: go vet ./...                             exit 0
apps/api: go test ./...
ok github.com/ai-manju/api/internal/handler 15.276s
ok github.com/ai-manju/api/internal/router 1.159s
ok github.com/ai-manju/api/internal/service 1.402s
其余有测试包均 ok

pnpm --filter ai-manhua-studio check                tsc --noEmit, exit 0
pnpm --filter ai-manhua-studio test
Test Files 180 passed (180)
Tests 1112 passed (1112)
pnpm --filter ai-manhua-studio build                exit 0

pnpm --filter @basketikun/canvas-agent test
tests 4 / pass 4 / fail 0
pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests 686 passed (686)

Worker compileall: 成功
Worker unittest: Ran 82 tests; OK (skipped=1)
```

Worker 宿主 Python 缺少 psycopg/celery/billiard，原生命令因依赖失败；随后用现有 `studio-beta-worker:20260911` 镜像、当前源码只读挂载、`--network none` 和临时 pycache 运行同一 compileall/unittest，通过以上检查。

新增测试覆盖半积分单任务汇总、活动折扣取整、flare 缺省行、Fast 有无参考视频、音频开关、画布非方形尺寸、mask 排除、客户端不能以 studio_model 改价、自动范围、未知时长、报价参数归一化、余额排除冻结、参数变化不显示旧报价。

本地独立 memory API（62241）+ Vite（62240）浏览器核验：

- 首页真实可用余额 0，Agent 免费。
- 图片 flare 1K/low/1 张显示“预计 5 积分”。
- 视频 Fast 720p/6 秒显示“预计 270 积分”，原粗估底栏已移除。
- 画布列表和新建实际画布顶部均显示“可用积分 0”；文本模式显示免费，文本生图入口显示预计 5 积分。
- 浏览器截图接口失败，以上为浏览器 DOM 观察，不能声称已完成截图视觉验收。全景/编辑/重试等由组件与服务测试覆盖。

## 部署

拉取本提交后的 master，重建并更新 API 与 Web（须同步发布报价接口及调用方）。无需数据库迁移、重置配置或删除数据卷。保持现有完整 Compose 拓扑和 billing_enabled 设置。按健康检查及登录后的只读报价、余额、定价页验收；不触发付费任务、不接入支付渠道。部署结果回报当前任务与交接中心。
