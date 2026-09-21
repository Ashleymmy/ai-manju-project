# ChinaMobil（tokenspace）

在管理员的模型配置页面新建视频 Provider，选择 **ChinaMobil（tokenspace）**，填写新通道的 API Key 后保存。该预设使用独立的 Provider 记录，不需要修改现有 `sdvideo` 配置，也不需要填写火山 AK/SK。

预置模型：

- `doubao-seedance-2-5-260628`
- `doubao-seedance-2-0-260128`（默认）
- `doubao-seedance-2-0-fast-260128`
- `doubao-seedance-2-0-mini-260615`

视频接口的 Base URL 为 `https://api.tokenspace.net.cn/api/v3`；创建和查询任务使用 `/contents/generations/tasks`。素材接口为 `https://api.tokenspace.net.cn/api/material?Action=...`，两者均使用本 Provider 的 Bearer API Key。

画布图片注册素材时选择这个 Provider 对应的模型，视频节点也选择同一 Provider。注册依次使用 `CreateAssetGroup`、`CreateAsset`、`GetAsset`，状态为 `Active` 后才允许引用 `asset://{AssetID}`。素材按 Provider 和用户隔离；已有公司代理、官方火山或其他 TokenSpace 账号的素材需要在新通道重新注册。含已注册素材的视频请求不会自动切换到另一 Provider，避免账号错配。

如果 TokenSpace 要求首次初始化，访问其 [素材初始化页面](https://api.tokenspace.net.cn/material/init)，按服务商要求配置。上游模型权限仍以新 Key 所属账号为准。

本次预设不创建真实 Provider 记录、不复制旧密钥、不调整计费规则。模拟测试覆盖注册、状态查询、模型路由与账号隔离；真实生成由用户填写新 Key 后手动验收。

参考：[TokenSpace 接入文档](https://ai.tokenspace.net.cn/apiDoc.html)。
