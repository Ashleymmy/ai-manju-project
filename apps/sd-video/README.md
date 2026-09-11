# AI-Manju 独立 SD-video 服务

这是 Studio 云端部署使用的独立视频业务服务。它保留 SD-video 的 Provider、任务、对话、媒体库、火山素材和 MediaKit 后端能力，但不包含旧 Jinja/Alpine 页面。

## 边界

- 浏览器只能访问 Studio Go API；本服务不提供浏览器 CORS 入口。
- 本服务只信任 Studio 签发的短期 JWT，不连接旧 Supabase Auth。
- 数据库、Redis 和 Provider 密钥使用新环境资源。按 2026-09-08 确认，媒体持久化通过本地 Supabase Storage API 接 NAS 阵列；只使用新建专属私有桶和受限身份，不读取旧业务。
- `D:\ITEM\SD-video` 仅作为源码参考，不是运行时依赖。

## 本地启动

```powershell
Copy-Item .env.example .env
docker compose --env-file .env -f docker-compose.sd-video.yml up --build
```

开发模式使用确定性的 mock task provider；生产环境必须配置新的服务 JWT 公钥、独立数据库、对象存储和 Provider 密钥，并将 `SD_VIDEO_EXECUTION_MODE=provider`、`SD_VIDEO_MODE=active` 作为灰度开关。`legacy` 仅用于迁移期间的本地兼容，不得连接生产环境旧 SD-video 资源。

健康检查：`GET http://127.0.0.1:8201/health/ready`。

## NAS / Supabase Storage

使用 `STORAGE_BACKEND=supabase`，配置独立的 `SDVIDEO_SUPABASE_*` 四桶与短期 `STORAGE_TOKEN_FILE`；旧 `SDVIDEO_SUPABASE_KEY` 不再受支持。读写 URL 必须为 HTTPS origin，`PUBLIC_URL` 用于 Provider 可达的签名媒体地址。`API_KEY_FILE` 仅在网关要求时填写公开 anon JWT，禁止 service_role。

应用每次请求重读令牌文件，但不持有签发私钥，也不自行续期。部署需由受信存储侧定时签发并通过认证加密通道分发；Compose 应挂载 Secret 目录以支持原子轮换。完整隔离模板、签发工具和验收门禁在主仓库 `deploy/cloud/` 与 `docs/SDVIDEO-PHASE2-IMPLEMENTATION.md`，不作为本服务运行时依赖。
