# 火山方舟官方直连

独立 SD-video 新增 `ark_official` Provider，后台模型提供商列表和视频模型列表中显示 **Seedance 2.0 · 火山方舟官方**（`sdvideo::seedance-2.0-ark` / `seedance-2.0-ark`）。已有数据库自动补入这一个配置项，保留原有模型设置。TokenSpace、旧代理的模型和凭证不受影响。

## 配置

在 ECS **现有 SD-video runtime env** 中填写配置，凭证使用已有 Secret 目录下的独立文件；不要将凭证写入 Studio 表单或仓库。

```dotenv
# 视频生成：API Key
ARK_OFFICIAL_BASE_URL=https://ark.cn-beijing.volces.com
ARK_OFFICIAL_API_KEY_FILE=/run/secrets/sdvideo/ark-official-api-key
ARK_OFFICIAL_MODEL_ID=doubao-seedance-2-0-260128

# AIGC 素材管理：同一账号/项目的 AK、SK
ARK_OFFICIAL_ASSET_BASE_URL=https://ark.cn-beijing.volcengineapi.com
ARK_OFFICIAL_ACCESS_KEY_ID_FILE=/run/secrets/sdvideo/ark-official-ak
ARK_OFFICIAL_SECRET_ACCESS_KEY_FILE=/run/secrets/sdvideo/ark-official-sk
ARK_OFFICIAL_REGION=cn-beijing
ARK_OFFICIAL_PROJECT_NAME=default
# 临时凭证可额外配置 ARK_OFFICIAL_SECURITY_TOKEN_FILE

# 注册入口默认提交到官方，此项可以省略；原代理视频模型仍保留。
SEEDANCE_ASSET_PROVIDER=ark_official
```

独立官方项不回退使用 `ARK_API_KEY`、`SEEDANCE20_KEY` 或 `TOKENSPACE_API_KEY`。只有 API Key 时可生成视频，但素材注册 readiness 会提示缺少 AK/SK。后台可修改模型 ID（也支持官方推理接入点 ID）、名称、并发和启停；凭证只由 SD-video 管理。

## Studio 直连官方 Provider

Provider Hub 另有一个独立的 **“火山方舟官方 Seedance”** 预设，ID 为 `volcengine_ark_official`。它不修改截图中的 `sdvideo` Provider，也不读取 SD-video 的运行时凭据。选择该预设后，表单会显示：

- API Key：视频推理；
- Access Key ID（AK）：官方素材接口签名；
- Secret Access Key（SK）：官方素材接口签名；
- Security Token：使用临时凭证时可选。

该直连 Provider 的 AK/SK 会使用 Studio 的加密 Provider 密钥存储，并由 Studio API 直接调用官方 AIGC 素材接口。它与 `sdvideo::seedance-2.0-ark` 是两条独立链路，不能混用已注册资产。若继续使用截图中的 `sdvideo` Provider，仍按本文前面的 ECS secret 文件方式配置。

方舟控制台生成的单个 API Key（不要求固定前缀）用于视频推理，不能替代素材接口要求的 Access Key ID / Secret Access Key。默认配置只涵盖上游地址、北京区域、`default` 项目、模型和官方注册路由，不能提供或推导凭证。因此只配置一个 API Key 并重建应用，可手动验证视频生成；官方素材注册仍需在同账号下配置 AK/SK，并完成火山要求的授权。

`SEEDANCE_ASSET_PROVIDER` 未设置或为空时均使用 `ark_official`。需要继续向 TokenSpace/旧代理注册新素材的部署，应显式设为 `tokenspace` / `legacy_proxy`。已注册素材的查询、删除仍使用各自记录的 Provider。

本地根 Compose 或 `apps/sd-video/docker-compose.sd-video.yml` 使用相应的 `SDVIDEO_` 前缀变量；`*_FILE` 必须是容器内已挂载的路径。直接运行 Python 时使用无前缀的 `ARK_OFFICIAL_*` / `SEEDANCE_ASSET_PROVIDER`。不要重新运行 NAS 初始化脚本。

若希望现有 `seedance-2.0` 槽也切换到官方，可另设 `SEEDANCE20_PROVIDER=ark_official`；默认不切换。视频任务记录会保存提交时的 Provider 和模型，后续改配置不改变已提交任务的查询/取消路由。

## 官方协议与使用条件

- 视频：`https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`，Bearer API Key；创建、查询和官方 DELETE 取消/删除接口。正在运行的任务可能不支持取消，遵循官方响应。
- 素材：`https://ark.cn-beijing.volcengineapi.com/?Action=...&Version=2024-01-01`，`ark` 服务、`cn-beijing` 区域的 HMAC-SHA256 签名；CreateAssetGroup（`GroupType=AIGC`）、CreateAsset、GetAsset、DeleteAsset。
- 首次创建 AIGC 素材组前，需在火山控制台签署官方要求的授权函，并具备该项目的素材管理权限。readiness 只检查本地配置，不代表云端已授权。
- 素材异步处理至 `Active` 后才可作为 `asset://<ID>` 输入。不同 Provider、凭证或项目的资产不可混用；切换后需要为官方重新注册。既有代理资产不会被迁移或删除。
- 本功能覆盖 AIGC 拟真人资产。真人肖像的 H5 活体认证/授权流程属于另一套官方 API，不会被此注册入口代替。
- 素材仍先保存至独立 NAS，提交时生成公网 **HTTPS** 签名 URL。`SDVIDEO_SUPABASE_PUBLIC_URL` 必须指向可被官方访问的 Studio HTTPS 域名，内部 NAS 地址不得作为 Provider 输入；当前临时 HTTP 入口不满足 Worker 的素材提交要求。

## 部署与手动验收

1. 用户在 ECS 拉取代码，更新现有 runtime env 与独立凭证文件。
2. 使用当前完整 Compose 组合重建 SD-video API、Worker、Asset Worker、Studio Go API 和 Web。若使用生成的 mock overlay，确认其执行模式及清空凭证的设置没有覆盖手工配置。不需重建数据库或删除卷。
3. 后台确认独立官方模型可用；素材 readiness 显示 `provider_id=ark_official`、`provider_protocol=ark_official_asset`。
4. 用户上传一张符合官方要求的 AIGC 素材，等待 `Active`；选择官方模型手动发起一次视频测试，检查结果导入 Studio Asset。

自动验证仅使用 MockTransport/本地仓库，不创建真实资产或付费视频任务。

## 官方参考（2026-09-17 核验）

- [CreateAssetGroup](https://www.volcengine.com/docs/82379/2318270)
- [CreateAsset](https://www.volcengine.com/docs/82379/2318271)
- [GetAsset](https://www.volcengine.com/docs/82379/2318274)
- [DeleteAsset](https://www.volcengine.com/docs/82379/2318278)
- [视频生成教程](https://www.volcengine.com/docs/82379/2291680)
- [肖像素材使用说明](https://www.volcengine.com/docs/82379/2608626)
- [官方 Python 签名实现](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkcore/signv4.py)

## 本次本地验证

关键实际输出：

```text
SD-video pytest: 185 passed（包含默认官方路由及缺少 AK/SK 时拒绝注册）
Studio: Test Files 124 passed (124), Tests 651 passed (651)
Canvas Agent: tests 4, pass 4, fail 0
Director Desk: Test Files 87 passed (87), Tests 686 passed (686)
Worker (Linux, network=none): Ran 78 tests; OK (skipped=1)
部署配置: Ran 11 tests; OK
存储复制回归 (Linux, network=none): Ran 20 tests; OK
```

Go `build ./...`、`vet ./...`、`test ./...` 均退出 0；Studio `check`、`build` 及 Python `compileall` 通过。Windows 原生旧 Worker 测试因缺少依赖/POSIX 信号失败，存储复制测试因符号链接权限失败，均已在断网 Linux 临时容器用当前源代码验证通过。未连接 ECS、NAS 或真实 Provider。
