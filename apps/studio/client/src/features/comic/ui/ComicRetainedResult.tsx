import type { ComicRetainedCandidate } from "../controllers/operationRecovery";

export function ComicRetainedResult({ candidate, onClose }: { candidate: ComicRetainedCandidate; onClose: () => void }) {
  return <section role="region" aria-label="已保留的生成结果" className="comic-panel">
    <h3>{candidate.title}</h3>
    <p>生成期间原内容已被修改，结果已保留，没有覆盖当前内容。你可以选择并复制下方文本，核对后手动编辑。</p>
    <textarea aria-label={candidate.title} readOnly value={candidate.content} rows={8} style={{ width: "100%" }} />
    <button type="button" onClick={onClose}>收起保留结果</button>
  </section>;
}
