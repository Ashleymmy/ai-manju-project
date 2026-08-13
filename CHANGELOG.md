# Changelog

## 0.3.0-beta.0 - 2026-07-17

+ [新增] 漫剧资产助手支持剧本多轮分析、版本比较与回退、定向提示词优化、批量审核和后台批量生图。
+ [新增] 资产库支持系统/用户目录、来源与分类管理、30 天回收站、批量删除以及后台 ZIP 导出。
+ [新增] 画布支持可拉伸提示词面板、资产引用、项目快速切换、选区导入导出、Agent 在线/本地双通道和更多图片处理工具。
+ [新增] Provider 全局并发闸门、workspace 公平调度、429 共享冷却与恢复机制。
+ [调整] 关键帧工作区支持滚动、新建并持久化草稿，复用画布用户预设及服务端资产库。
+ [调整] 图片节点长工具条改为节点上方向上展开的网格卡片，避免横跨画布。
+ [修复] 文本模型完整保留 Provider 选择器，并兼容 Responses、Chat Completions、JSON、SSE 与 Agent tool calls。
+ [修复] 图像节点默认比例使用 auto，资产导出 Worker 正常消费队列，历史 Provider 密钥可在稳定 Secret 下解密。
+ [修复] 标注撤销/重做、文本双击编辑、Delete、画布缩放冲突、复制连线和节点快速聚焦等生产交互问题。
+ [调整] 普通登录有效期为 24 小时，记住登录有效期为 30 天。

## 0.2.0 - 2026-07-03

This release packages the current AI-Manju iteration for release readiness.

### Changed

- Reworked the backend into the current layered shape across handlers, services, repositories, providers, queue, storage, middleware, auth, config, and response helpers.
- Added Redis-backed async job execution with idempotency, retry, timeout, cancellation, dead-letter handling, SSE progress streaming, and polling fallback.
- Added the Python worker path for asynchronous media work, including provider calls, asset persistence, and FFmpeg-backed video processing.
- Added storage abstraction for generated/uploaded assets with local and deployment-ready storage paths.
- Added Playwright E2E coverage for auth, canvas generation/edit flows, cancel/retry/recovery behavior, SSE fallback, announcements, and the WP-021 canvas enhancement set.
- Aligned the real upstream image provider protocol, including multipart `image.edit` behavior and provider error detail handling.
- Added the WP-021 canvas creation enhancements: draggable annotations, video frame capture, user prompt presets, wider multi-angle controls, outpainting, storyboard export, panorama generation, image flip actions, and focus extraction.

### Release Readiness

- Removed the obsolete `next lint` script from the web package because Next.js 16 no longer provides that command.
- Hardened the worker image to run as a non-root user.
- Added server-side caps for user prompt preset count and string lengths.
- Added release and rollback checklist documentation.

### Version

- `@ai-manju/web` and `@ai-manju/types` were advanced from `0.1.0` to `0.2.0` because this is a feature-bearing iteration release rather than a patch-only update.
