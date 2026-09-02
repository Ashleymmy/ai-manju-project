# 上游来源

- 仓库：<https://github.com/xiaozangao/3d-director-desk>
- 导入提交：`a6c931cd36d8263d986706f74ab4efe9d5151959`
- 导入日期：2026-08-05
- 上游版本：`0.3.1`
- 许可证：MIT，完整文本见 `LICENSE`

AI-Manju 仅调整 workspace 包名、开发端口、构建接入，并显式补充上游源码实际使用的 `three-stdlib`。导演台保持 React 18 运行时及 React 18 类型，宿主 Web 继续使用 React 19，通过独立 workspace 和 iframe 隔离两套依赖。导演台运行时逻辑、嵌入协议、模型资源及其许可证说明保持上游结构。

部署时由 `apps/studio/Dockerfile` 先构建本应用，Studio 的 Vite 构建插件再把 `dist/` 复制到 `/director-desk/` 静态路径。开发环境由 Studio 以同源 `/director-desk/index.html` 加载构建结果。
