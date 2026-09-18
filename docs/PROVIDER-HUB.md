# 模型接入模块

入口 `/admin/model-hub` 是独立页面，复用超级管理员登录与后端鉴权。管理后台的“模型接入”导航跳转到此页，原 `/admin/model-provider` 保持兼容。

## 配置职责

| 层 | 职责 |
| --- | --- |
| `packages/provider-hub` | 能力分类、Provider 列表、表单 / JSON 切换、文档校验和无凭据导出 |
| Studio 宿主 | 预设、密钥表单、API 调用、保存反馈、管理员路由 |
| Go `internal/providerhub` | 严格解析有版本的配置文档，不接受秘密字段与未知顶层字段 |
| 现有 Provider / SD-video 适配器 | 素材注册、请求转换、提交、轮询、取消、结果导入 |

JSON 通过 `config_document` 写到现有 `ModelProviderConfig` 字段，运行时直接读取；没有新增 `AdvancedConfig` 影子字段、数据库表或环境变量副本。旧的 Memory/GORM 仓库写入路径保持一致。

能力分为文本 / LLM、图像、视频和音频。现有完整预设表单继续使用，默认模型与模型列表只展示选中的能力。API Key 与其他密钥走原加密存储，JSON 不接受 API Key、Authorization Header 或含凭据的 URL。JSON 编辑有格式检查、格式化、导出、未保存修改保护与后端再次校验。

SD-video 保留一个 Provider 分组和一键启停，各模型展示真实上游通道；高级配置允许修改已有模型 ID、名称、并发与启停，保留 key / version 的校验。通道、注册协议和资产命名空间仍由 SD-video 服务统一负责，不允许从配置文档将已注册素材换到其他通道。

JSON 仅编辑已实现适配器支持的设置；任意脚本执行、自定义请求/响应 DSL、热更新 SD-video 凭据或通道尚未实现，不能把配置保存成功当成新协议已接通。真实任务由用户手动验收。

## 验证

共享工作树含协作者正在开发的会员模块，曾因其尚未齐全的接口编译失败。本次 Go 改动在干净的 `60de491` 检出上单独应用并验证，未覆盖或提交协作者改动。

```text
go build ./...             exit 0
go vet ./...               exit 0
go test ./...              exit 0
ok github.com/ai-manju/api/internal/handler
ok github.com/ai-manju/api/internal/providerhub
```

新增后端测试覆盖文档保存到运行配置、加密密钥保留、实际本地 mock 请求使用新模型和端点、非管理员拒绝、非法 JSON 不修改存储、SD-video 批量更新保留模型身份与资产通道。

```text
Studio check              exit 0
Studio test               Test Files 126 passed; Tests 660 passed
Studio build              built successfully
Canvas Agent              tests 4; pass 4; fail 0
Director Desk             Test Files 87 passed; Tests 686 passed
Worker compileall         exit 0
Worker unittest           Ran 42 tests; FAILED (errors=8, skipped=1)
```

Worker 测试受本机缺少 `billiard` 等依赖阻断；此次未修改 Worker，也未安装依赖。

本地浏览器实测（一次性内存 API、无上游生成调用）：

```text
PASS: admin route, capability selection, JSON save/reload, invalid JSON, responsive layout; no upstream calls
```

独立模块另通过类型检查、2 项文档测试和 Vite 演示构建。Cloud / ECS 未在本次变更中部署，也未发起真实或付费 Provider 任务。

## 独立仓库

导出内容为 `packages/provider-hub` 的组件、合同、测试、示例、文档及 MIT 声明，以及 Go 校验器；不包含项目数据库、环境配置、真实 Provider 列表或密钥。CC Switch 来源与原始 MIT 声明保存在模块目录。
