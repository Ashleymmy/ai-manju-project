# Studio Provider Hub

可复用的 Web 模型配置模块，提供文本 / LLM、图像、视频、音频分类、预设表单、带校验的高级 JSON 编辑及无凭据导出。借鉴 CC Switch 的 Provider 配置与 JSON 校验方式，适配 React Web 和服务端鉴权，不依赖 Tauri、Rust 或 CLI 配置文件。

## 独立演示

```sh
npm install
npm run dev
```

打开 `http://127.0.0.1:3199`。演示只读写页面内存，刷新后恢复示例，不连接真实模型，不发起生成任务。

```sh
npm run check
npm test
npm run build
```

## 在宿主中接入

```tsx
import { ProviderHub } from './src';
import './src/styles.css';

<ProviderHub
  providers={providers}
  draft={draft}
  onSelect={setDraft}
  onCreate={createDraft}
  onReload={reload}
  onSaveJSON={saveToAuthenticatedBackend}
  renderForm={() => <YourProviderForm />}
/>
```

宿主负责登录、管理员授权、Provider 列表、预设来源、保存和密钥加密。组件不持久化密钥，不调用生成 API。`ProviderConfigForm` 是可选基础表单；Studio 保留已有完整表单，复用预设、API Key、额外密钥、模型别名、图像协议和连接测试。

## JSON 合同

```json
{
  "schema_version": 1,
  "adapter": "studio",
  "config": {
    "name": "示例视频服务",
    "provider_type": "volcengine_ark",
    "mode": "openai_compatible",
    "base_url": "https://example.invalid/api/v3",
    "auth_type": "bearer",
    "capabilities": ["video"],
    "video_model": "your-upstream-model-id",
    "models_by_capability": { "video": ["your-upstream-model-id"] },
    "endpoint_overrides": {
      "video_create": "/contents/generations/tasks",
      "video_get": "/contents/generations/tasks/{id}"
    },
    "timeout_ms": 120000,
    "max_concurrency": 3,
    "enabled": true
  }
}
```

`config` 编辑已有运行字段，未提供的字段保持不变。模型 ID 与 Provider ID 分离，Provider ID 由宿主选中的记录确定。保存时使用原接口的 `config_document` 参数；`api_key` / `secrets` 只能作为外层的独立密钥字段提供。留空不会清除密钥。

Studio 适配器支持：名称、预设、服务类型、模式、地址、鉴权类型与字段名、按能力的模型列表与默认模型、显示别名、图像协议、端点覆盖、非敏感 Header、超时、并发和启停。未知字段和错误类型会被拒绝，不能仅通过 JSON 添加尚未实现的新协议、脚本或任意请求/响应转换器。

SD-video 适配器支持 `config.sdvideo_models` 中的 `key`、`name`、`model_id`、`enabled`、`concurrency_limit`、`version`。模型 key、完整集合与版本由服务核对。上游通道、素材注册协议、命名空间和凭据仍由独立 SD-video 适配器统一管理，JSON 不允许把已注册资产切换到另一通道。配置凭据不等于真实生成验收通过。

## 主仓库集成

- 源码：`packages/provider-hub/src`。
- 独立路由：`/admin/model-hub`，前端 `super_admin` 守卫；旧 `/admin/model-provider` 保持兼容。
- API：沿用 `/api/admin/model-providers` 和 `/api/admin/model-providers/:id` 的超级管理员鉴权。
- Go 校验器：`apps/api/internal/providerhub`，纯标准库；独立仓库导出到 `go/`。
- 不新增配置表或迁移，Memory/GORM 使用现有 `ModelProviderConfig` 字段；表单和 JSON 不产生两份配置。
- 视频注册/提交/查询/取消链路继续交由已实现的运行适配器，本模块负责编辑其公开管理配置。

## 来源

参考 [CC Switch](https://github.com/farion1231/cc-switch)，版本 `06082e189d65e6d6dbadc35dacdac1ce6c79d89a`。JSON 对象校验和禁止原型字段的处理来自其配置工具的适配；详见 `THIRD_PARTY_NOTICES.md` 与 `licenses/cc-switch.MIT`。
