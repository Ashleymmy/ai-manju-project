import type { Dispatch, SetStateAction } from "react";
import { Save } from "lucide-react";
import type {
  ModelProviderConfig,
  SDVideoManagedModel,
} from "../services/adminApi";

export function SDVideoProviderEditor({
  draft,
  setDraft,
  busy,
  save,
}: {
  draft: ModelProviderConfig;
  setDraft: Dispatch<SetStateAction<ModelProviderConfig>>;
  busy: boolean;
  save: (draft?: ModelProviderConfig) => void;
}) {
  const models = draft.sdvideo_models || [];
  const enabled = models.filter(model => model.enabled).length;
  const configured = models.filter(
    model => model.credentials_configured
  ).length;
  const update = (key: string, changes: Partial<SDVideoManagedModel>) =>
    setDraft(current => ({
      ...current,
      sdvideo_models: current.sdvideo_models?.map(model =>
        model.key === key ? { ...model, ...changes } : model
      ),
    }));
  const setAll = (value: boolean) => {
    const next = {
      ...draft,
      enabled: value,
      sdvideo_models: models.map(model => ({ ...model, enabled: value })),
    };
    setDraft(next);
    save(next);
  };
  return (
    <section
      className="provider-form sdvideo-provider-editor"
      aria-label="sdvideo 模型配置"
    >
      <div className="provider-section-head provider-form-full">
        <div>
          <b>sdvideo</b>
          <small>
            {models.length} 个视频模型 · {enabled} 个启用 · {configured}{" "}
            个已配置凭据
          </small>
          <small>
            全部启用／停用会立即保存。单项修改后点击保存配置；凭据配置完成不代表已通过生成验收。
          </small>
        </div>
      </div>
      <div className="provider-form-actions">
        <button
          className="outline-button small"
          disabled={busy}
          onClick={() => setAll(true)}
        >
          全部启用
        </button>
        <button
          className="outline-button small"
          disabled={busy}
          onClick={() => setAll(false)}
        >
          全部停用
        </button>
        <button
          className="vermilion-button"
          disabled={busy}
          onClick={() => save()}
        >
          <Save size={16} /> 保存配置
        </button>
      </div>
      <div className="sdvideo-model-list provider-form-full">
        {models.map(model => (
          <fieldset
            key={model.key}
            disabled={busy}
            className="sdvideo-model-row"
          >
            <legend>{model.name}</legend>
            <label>
              显示名称
              <input
                aria-label={`${model.key} 显示名称`}
                value={model.name}
                onChange={event =>
                  update(model.key, { name: event.target.value })
                }
              />
            </label>
            <label>
              模型 ID
              <input
                aria-label={`${model.key} 模型 ID`}
                value={model.model_id}
                onChange={event =>
                  update(model.key, { model_id: event.target.value })
                }
              />
            </label>
            <label>
              并发数
              <input
                aria-label={`${model.key} 并发数`}
                type="number"
                min={1}
                max={16}
                value={model.concurrency_limit}
                onChange={event =>
                  update(model.key, {
                    concurrency_limit: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="provider-switch-label">
              启用
              <input
                aria-label={`${model.key} 启用`}
                type="checkbox"
                checked={model.enabled}
                onChange={event =>
                  update(model.key, { enabled: event.target.checked })
                }
              />
            </label>
            <small
              className={
                model.credentials_configured
                  ? "sdvideo-ready"
                  : "sdvideo-missing"
              }
            >
              {model.credentials_configured
                ? "凭据已配置"
                : "缺少凭据，启用后仍不可生成"}
            </small>
            {model.creation_disabled_reason && (
              <small className="sdvideo-missing">
                {model.creation_disabled_reason}
              </small>
            )}
          </fieldset>
        ))}
      </div>
      <div className="provider-form-actions">
        <button
          className="vermilion-button"
          disabled={busy}
          onClick={() => save()}
        >
          <Save size={16} /> 保存配置
        </button>
      </div>
    </section>
  );
}
