import {
  ArrowLeft,
  ArrowUpRight,
  Box,
  Check,
  Clapperboard,
  Loader2,
  Save,
  WandSparkles,
} from "lucide-react";

import { useDirectorDeskController } from "../controllers/useDirectorDeskController";
import { DIRECTOR_SCOPE_OPTIONS } from "../model/navigation";
import { DIRECTOR_PROTOCOL_VERSION } from "../model/protocol";

export default function DirectorDeskView() {
  const {
    iframeRef,
    ready,
    busy,
    lastAsset,
    lastFrame,
    capabilities,
    scope,
    setScope,
    hasCanvasTarget,
    directorSrc,
    exportFrame,
    sendToCanvas,
    returnToCanvas,
    openStandalone,
  } = useDirectorDeskController();

  return (
    <div className="feature-page director-page director-embed-page">
      <div className="feature-title">
        <div>
          <p className="eyebrow">DIRECTOR / EMBED</p>
          <h1>{hasCanvasTarget ? "画布 3D 导演台" : "3D 导演台"}</h1>
          <p>
            {hasCanvasTarget
              ? "当前机位会回写原 Director 节点，并创建相连的图片结果节点。"
              : "真实嵌入 director-desk，导出的当前帧会进入资产库，并可衍生为画布节点。"}
          </p>
        </div>
        <div className="director-actions">
          {hasCanvasTarget ? (
            <button
              className="outline-button small"
              onClick={returnToCanvas}
              disabled={busy}
            >
              <ArrowLeft size={15} /> 返回画布
            </button>
          ) : null}
          <div className="scope-switch mini-scope">
            {DIRECTOR_SCOPE_OPTIONS.map(item => (
              <button
                key={item.value}
                className={scope === item.value ? "active" : ""}
                onClick={() => setScope(item.value)}
                disabled={hasCanvasTarget || busy}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className={`status-chip ${ready ? "succeeded" : "running"}`}>
            {ready ? "已连接" : "等待导演台"}
          </span>
          <button
            className="outline-button small"
            onClick={() => void exportFrame()}
            disabled={!ready || busy}
          >
            <Save size={15} /> {busy ? "保存中" : "保存当前帧"}
          </button>
          <button
            className="vermilion-button"
            onClick={() => void sendToCanvas()}
            disabled={!ready || busy || (!hasCanvasTarget && !lastAsset)}
          >
            <WandSparkles size={16} />
            {hasCanvasTarget ? "保存并返回画布" : "送入画布"}
          </button>
        </div>
      </div>
      <div className="director-embed-layout">
        <section className="director-frame-shell">
          {!ready && (
            <div className="director-loading">
              <Loader2 className="spin" size={28} />
              <span>正在连接导演台…</span>
            </div>
          )}
          <iframe ref={iframeRef} src={directorSrc} title="3D 导演台" />
        </section>
        <aside className="director-embed-side">
          <p className="eyebrow">EXPORT RESULT</p>
          <div className="director-export-card">
            {lastFrame?.dataUrl ? (
              <img src={lastFrame.dataUrl} alt="导演台当前帧" />
            ) : (
              <Box size={34} />
            )}
            <b>{lastAsset?.name || "暂无导出帧"}</b>
            <span>
              {lastFrame?.width && lastFrame?.height
                ? `${lastFrame.width} × ${lastFrame.height}`
                : "导出后显示尺寸"}
            </span>
          </div>
          <div className="director-capability-list">
            <div>
              <Clapperboard size={16} />
              <span>协议版本</span>
              <b>
                {String(
                  capabilities?.protocolVersion || DIRECTOR_PROTOCOL_VERSION
                )}
              </b>
            </div>
            <div>
              <Check size={16} />
              <span>资产归档</span>
              <b>{lastAsset ? "已写入" : "待导出"}</b>
            </div>
            <button onClick={openStandalone}>
              <ArrowUpRight size={15} /> 独立打开导演台
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
