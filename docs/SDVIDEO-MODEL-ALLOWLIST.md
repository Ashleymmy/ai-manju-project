# SD-video：模型可见但提交被白名单拒绝

## 本次定位

用户报告 Seedance 2.5 提交返回 `video model is not enabled for this workspace`，
同一工作区 Seedance 2.0 可以提交、其他模型不行。

这条错误来自 Studio Go API 的 `AllowsCreation` 检查，发生在持久化新 Job/outbox、
参考素材上传和 Provider 调用之前。相同工作区中 2.0 可以提交，说明该请求的工作区和
`SD_VIDEO_MODE=active` 已通过；其他模型的逻辑 key 未匹配 `SD_VIDEO_ALLOWED_MODELS`。
本地没有读取 ECS 的实时配置，具体白名单值仍需在部署端核对。

原来的模型发现只检查 SD-video 返回的 `available`，没有检查 Studio 的部署白名单，
因此生成页面可以选到随后会被 Studio 拒绝的模型。

## 代码修复

- `/api/ai/models` 仅将上游可用、且当前工作区被允许提交的 SD-video 模型加入候选与默认模型。
- Gateway 模型列表及管理页保留全部模型配置，叠加当前工作区的可提交状态和原因。
- 管理页分别显示凭据状态与部署限制；单项保存、批量保存都保留限制提示。
- 提交与重试区分模型白名单、工作区白名单；保持原有状态码、响应信封和权限限制。
- 未修改 Memory/Gorm 存储逻辑、Provider 路由、请求格式或凭据。

## ECS 配置处理

在现有完整 Compose 参数后执行以下子命令，仅查看 API 容器中这三项非密钥配置：

```sh
exec -T api printenv SD_VIDEO_MODE SD_VIDEO_ALLOWED_MODELS SD_VIDEO_ALLOWED_WORKSPACES
```

值按上述变量顺序输出；未设置的变量没有输出。若 Studio 的实际运行配置设置了非空模型白名单，
在原值中追加本次要测试的模型逻辑 key，保留其他现有条目。例如只测试这两个模型时：

```dotenv
SD_VIDEO_ALLOWED_MODELS=seedance-2.0,seedance-2.5
```

这里必须用 SD-video 模型的 `key`，不是管理页显示名称，也不是可编辑的上游模型 ID。
带 `sdvideo/` 前缀的 key 也兼容。其他模型按管理接口返回的 `key` 逐项追加。
空值表示不限制模型，`*` 不表示通配；不要为此次测试擅自清空已有白名单。

检查原有 Compose override 的 `environment` 是否覆盖 `env_file` 中的值。
改好后沿用原有全部 Compose 文件、override 和 env 参数重建 `api` 容器；
只 restart 不会读取变更后的容器环境。再次检查容器中的有效值。

仅解除白名单限制不要求改 Provider 或重建 SD-video Worker。
部署本次候选过滤和管理页提示修复时，还需更新并构建、重建 Studio `api` 和 `web`。
不需要重建数据库、删除卷或重新运行初始化脚本。

## 无付费调用的确认

刷新页面后检查生成模型列表、管理页的限制提示。已启用且凭据齐全的模型在被白名单放行后
才应进入生成候选；被限制的模型仍应拒绝直接提交和重试。真实生成由用户手动测试。

当前代码中 `seedance-2.5` 仍走原来的 `legacy_proxy` 路由；
`seedance-2.0` 使用 `SEEDANCE20_PROVIDER`，官方直连使用独立的 `seedance-2.0-ark`。
放行模型不会迁移其 Provider，也不能证明对应上游凭据和模型 ID 已通过真实生成验收。

## 本地验证（2026-09-17）

以下为本轮实际执行结果；完整日志保存在本地忽略目录 `.tmp/sdvideo-creation-policy/`。

| 检查 | 实际输出 / 结果 |
| --- | --- |
| Go `go build ./...`、`go vet ./...` | 均退出 0，无错误输出 |
| Go `go test ./...` | 全部通过；`internal/handler 12.683s`、`internal/sdvideo 0.841s`、`internal/service 5.427s` |
| Studio `check` | `tsc --noEmit`，退出 0 |
| Studio `test` | `Test Files 125 passed (125)`；`Tests 655 passed (655)` |
| Studio `build` | Director `built in 4.24s`；Studio `built in 2.98s`，退出 0；保留 Director 已有大 chunk 提示 |
| Canvas Agent `test` | `tests 4`、`pass 4`、`fail 0` |
| Director Desk `test` | `Test Files 87 passed (87)`；`Tests 686 passed (686)` |
| Worker Linux 隔离容器 compileall + unittest | `Ran 78 tests in 0.234s`；`OK (skipped=1)`；未设置 `REDIS_TEST_URL`，既有 Redis 集成测试跳过 |

新增回归覆盖 2.0 单独放行、2.5 放行、逻辑 key 前缀、工作区隔离、shadow/disabled、
默认模型回退、管理页保存后保留提示、凭据状态独立、提交与重试拒绝时不新增 Job。
测试上游只允许本机模型列表读取，未运行 Bridge 或提交真实生成任务。
未连接 ECS、读取真实密钥或发起付费 Provider 请求；云端配置生效和真实生成仍待部署后手动验收。
