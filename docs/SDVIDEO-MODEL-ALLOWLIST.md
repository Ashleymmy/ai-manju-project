# SD-video 模型启用策略

## 当前规则

SD-video 的模型启用状态由独立 SD-video 服务的模型目录管理。Studio 只检查两项边界：

- `SD_VIDEO_MODE` 必须为 `active`；
- `SD_VIDEO_ALLOWED_WORKSPACES`（如果设置）必须允许当前工作区。

`SD_VIDEO_ALLOWED_MODELS` 不再参与请求判断，也不再出现在模型接入页面。模型的 `key`、上游通道、素材注册归属和凭据仍由 SD-video 服务统一管理；管理页的开关只更新服务返回的模型启用状态。

这样可以避免同一模型在 SD-video 已启用后，又被 Studio 宿主机上的第二份模型白名单拦截。视频模型仍可能因为上游不可用、凭据缺失、工作区限制或服务处于 shadow/disabled 模式而不可提交，页面会分别显示对应状态。

## 管理页面

`/admin/model-hub` 将 SD-video 展示为一个 `sdvideo` Provider，模型默认折叠显示。展开单个模型后可以编辑显示名称、模型 ID 和并发上限；通道标签只读，避免误把已注册素材切换到另一条通道。全部启用/停用会以一次批量请求写回 SD-video 服务。

配置 JSON 只允许编辑已有模型的公开管理字段，不能写入 Provider 凭据、通道或任意请求协议。真实生成仍由管理员手动验收。

## ECS 检查

无需修改或清空现有环境文件，也无需重建数据库、Redis、SD-video Worker 或素材存储。检查时只读取非敏感状态：

```sh
docker compose exec -T api printenv SD_VIDEO_MODE SD_VIDEO_ALLOWED_WORKSPACES
```

部署 API 后，刷新 `/api/ai/models` 和管理页面，确认 SD-video 服务返回的 `available` 与模型启用状态一致。不要输出 Token、API Key、私钥或完整签名 URL。

## 验证范围

本次回归覆盖 active/shadow/disabled、工作区边界、旧模型白名单不再阻断、后台批量模型更新和管理员权限；测试上游使用本地 mock，不发起真实或付费 Provider 任务。真实任务由用户手动测试。
