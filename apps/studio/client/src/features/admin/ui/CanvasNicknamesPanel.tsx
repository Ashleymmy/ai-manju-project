// [画布别名] 后台「画布别名」页（左侧导航位于「模型接入」之后）。
import { RefreshCcw, Save } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useCanvasNicknamesController } from "../controllers/useCanvasNicknamesController";
import { MAX_CANVAS_NICKNAME_LENGTH, canvasNicknameGroups, type CanvasNicknameGroup } from "../model/canvasNicknames";
import "./model-prices.css";
import "./canvas-nicknames.css";

export function CanvasNicknamesPanel({ readOnly }: { readOnly: boolean }) {
  const { query, nicknames, changes, busy, error, saved, edit, save, discard } = useCanvasNicknamesController(readOnly);
  const [group, setGroup] = useState<CanvasNicknameGroup>("image");
  const [search, setSearch] = useState("");
  const keyword = search.trim().toLowerCase();
  const rows = (query.data?.rows[group] ?? []).filter(row => !keyword
    || [row.id, row.displayName, nicknames[row.id] || ""].some(text => text.toLowerCase().includes(keyword)));

  return <section className="real-admin-section model-prices-panel canvas-nicknames-panel">
    <div className="admin-panel-head">
      <div><h2>画布别名</h2><p>给成员侧的模型起一个好记的名字。只影响成员看到的名称，请求、计费和后台记录仍使用真实模型 ID。</p></div>
      <button type="button" className="outline-button small" disabled={busy || changes > 0 || query.isFetching} onClick={() => void query.refetch()}>
        <RefreshCcw size={14} /> 刷新
      </button>
    </div>
    <p className="model-prices-note">别名会显示在画布、图片工作台、视频工作台、偏好设置和漫剧的模型选择中；画布的生成历史和图片预览显示标准名，别名以标签形式显示在旁边。同一模型 ID 在所有供应商下共用一个别名，留空表示沿用当前显示名称。</p>
    {query.isPending ? <p role="status">正在读取模型与别名…</p> : null}
    {query.isError ? <p role="alert">别名读取失败，请刷新重试。</p> : null}
    {query.data ? <>
      <div className="model-prices-controls">
        <div className="model-prices-tabs" aria-label="模型类型">
          {canvasNicknameGroups.map(([key, label]) => <button key={key} type="button" aria-pressed={group === key} onClick={() => setGroup(key)}>
            {label} <span className="canvas-nicknames-count">{query.data.rows[key].length}</span>
          </button>)}
        </div>
        <label className="model-prices-selector">搜索
          <Input value={search} placeholder="按模型 ID、显示名称或别名搜索" onChange={e => setSearch(e.target.value)} />
        </label>
      </div>
      <div className="model-prices-scroll">
        <table>
          <thead><tr>
            <th scope="col">真实模型 ID</th>
            <th scope="col">接入供应商</th>
            <th scope="col">当前显示名称（后台）</th>
            <th scope="col">画布别名</th>
            <th scope="col">成员看到</th>
          </tr></thead>
          <tbody>
            {rows.map(row => {
              const nickname = (nicknames[row.id] || "").trim();
              return <tr key={row.id}>
                <th scope="row"><code>{row.id}</code></th>
                <td>{row.providers.join("、") || "—"}</td>
                <td>{row.displayName}</td>
                <td>
                  <Input aria-label={`${row.id} 画布别名`} value={nicknames[row.id] || ""} maxLength={MAX_CANVAS_NICKNAME_LENGTH}
                    placeholder="留空沿用当前显示名称" disabled={readOnly || busy}
                    onChange={e => edit(row.id, e.target.value)} />
                </td>
                <td className={nickname ? "canvas-nicknames-preview" : "canvas-nicknames-preview fallback"}>{nickname || row.displayName}</td>
              </tr>;
            })}
            {!rows.length ? <tr><td colSpan={5} className="canvas-nicknames-empty">{keyword ? "没有匹配的模型。" : "当前分类暂无已接入的模型。"}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {error ? <p role="alert" className="model-prices-error">{error}</p> : null}
      <div className="model-prices-footer">
        <p role="status">{readOnly ? "当前账号仅可查看别名。" : saved ? "已保存，成员刷新页面后看到新别名。" : changes ? `有 ${changes} 项未保存修改。` : "当前显示已生效的别名。"}</p>
        {!readOnly ? <div>
          <button type="button" className="outline-button small" disabled={busy || !changes} onClick={discard}>撤销未保存修改</button>
          <button type="button" className="vermilion-button" disabled={busy || !changes} onClick={() => void save()}>
            <Save size={14} /> {busy ? "保存中…" : "保存别名"}
          </button>
        </div> : null}
      </div>
    </> : null}
  </section>;
}
