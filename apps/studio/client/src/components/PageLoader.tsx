/**
 * 页面级加载动画（cloudto 云格 · 页面切换「轻量流转」流光动画）。
 * 替换原全屏「连接工作区…」静态占位，用于路由 Suspense 兜底与鉴权加载态。
 * 注意：仅用于页面切换/鉴权等待；AIGC 生成等待沿用项目现有生成动画，不用本组件。
 */
import "./PageLoader.css";

export default function PageLoader({ label = "正在加载…" }: { label?: string }) {
  return (
    <div className="page-loader" role="status" aria-label={label}>
      <img
        className="page-loader-mark"
        src="/cloudto/motion/svg/page.svg"
        alt=""
        aria-hidden="true"
      />
      <p className="page-loader-text">{label}</p>
    </div>
  );
}
