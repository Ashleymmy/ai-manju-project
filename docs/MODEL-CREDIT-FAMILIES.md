# 模型计费系列

同一个官方系列通过不同供应商接入时，共用 `model_credit_prices` 中对应的系列价格。展示名称、上游请求 ID 与计费系列各有用途：修改展示名称不改价，绑定计费系列不改变发送给 Provider 的模型 ID。

固定 SD-video 逻辑 ID 的对应关系：

| 实际逻辑 ID | 计费系列 |
|---|---|
| `seedance-fast` | `seedance-2.0-fast` |
| `yike-wan3.0-video` | `wan-3.0` |
| `yike-wan3.0-video-prime` | `wan-3.0-prime` |

部署环境的 `ep-…` 等 ID 用 `billing_configs.model_credit_aliases` 保存对应关系，值为实际模型 ID 到价目表系列的 JSON 对象，例如：

```json
{"ep-example": "seedance-2.5"}
```

管理员可通过已有 `PUT /api/admin/billing/configs/model_credit_aliases` 接口保存完整映射（请求体 `{"value": {...}}`），通过已有配置读取接口查看；沿用现有管理员权限与审计。源 ID 不带 Studio Provider 前缀，目标必须是价目表中的正式系列；不允许串联映射、覆盖已识别系列或填入不存在的价格键。未知型号维持原计费规则。

报价与任务冻结使用相同的服务端映射，Fast 系列同时使用 Fast 活动折扣分类。客户端传入的 `studio_model`、`pricing_model` 或显示别名不会改写计费系列。已冻结的旧任务保持原金额，后续保存价格或修改映射只影响新任务。

当前用户确认 MT版权四款分别对应 Seedance 2.5、2.0、2.0 Mini、2.0 Fast；具体 endpoint 绑定保存在 ECS 配置中，不写死到业务代码。

后台「模型积分定价」（`/admin/model-prices`）已包含 `gemini-3-pro-image`、`gemini-3.1-flash-image` 的 1K/2K/4K，以及 Wan 3.0/Prime 的 1080p。首次补齐时采用当前基础兜底规则：图片 1K 对应 standard_1024，2K/4K 对应 large；Wan 1080p 无参考视频、有参考视频均对应 video_standard.per_second，参考视频附加费初始化为 0。云端当前初始化值分别为 50/80/80 积分每张、12/12/0 积分每生成秒，供管理员后续核价；这些不是供应商官方报价。

Gemini 没有画质档位，以单列分辨率价格表示；画布传入自动画质也使用选定分辨率的保存单价。尺寸为自动时仍走基础兜底价。支持画质档位的模型选择自动画质时沿用原兜底行为。图片参考图附加费逐张计入每个输出，蒙版不计费。

加载旧价目表时只补齐上述新增项和此前的 H3 480p，不覆盖已有价格（包括 0）；管理员修改并保存后，新任务报价与冻结实时使用保存值，旧任务积分不变。Wan 1080p 的附加费虽从 0 开始，仍支持后台修改。
