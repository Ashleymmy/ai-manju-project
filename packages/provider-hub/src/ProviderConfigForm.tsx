import type { ReactNode } from "react";
import { capabilities, capabilityLabels, type ConfigDocument } from "./config";

export type ProviderPreset = {
  id: string;
  name: string;
  config: Record<string, unknown>;
};
/** Optional lightweight form for hosts without an existing provider editor. */
export function ProviderConfigForm({
  document,
  onChange,
  onSave,
  busy,
  presets = [],
  credentials,
}: {
  document: ConfigDocument;
  onChange: (value: ConfigDocument) => void;
  onSave: () => void;
  busy?: boolean;
  presets?: ProviderPreset[];
  credentials?: ReactNode;
}) {
  const config = document.config;
  const update = (key: string, value: unknown) =>
    onChange({ ...document, config: { ...config, [key]: value } });
  const selected = (config.capabilities || []) as string[];
  if (document.adapter !== "studio")
    return (
      <p className="hub-form">此适配器请使用 JSON 编辑或宿主提供的模型表单。</p>
    );
  return (
    <fieldset className="hub-form" disabled={busy}>
      <label>
        服务预设
        <select
          defaultValue=""
          onChange={(event) => {
            const preset = presets.find(
              (item) => item.id === event.target.value,
            );
            if (preset)
              onChange({
                ...document,
                config: { ...config, ...preset.config },
              });
          }}
        >
          <option value="">选择预设</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        名称
        <input
          value={String(config.name || "")}
          onChange={(event) => update("name", event.target.value)}
        />
      </label>
      <label>
        API 地址
        <input
          value={String(config.base_url || "")}
          onChange={(event) => update("base_url", event.target.value)}
        />
      </label>
      <label>
        鉴权方式
        <select
          value={String(config.auth_type || "none")}
          onChange={(event) => update("auth_type", event.target.value)}
        >
          {[
            "none",
            "bearer",
            "x_api_key",
            "x_goog_api_key",
            "auto_api_key",
            "custom_header",
            "query_param",
          ].map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      </label>
      {config.auth_type === "custom_header" && (
        <label>
          Header 名称
          <input
            value={String(config.custom_auth_header || "")}
            onChange={(event) =>
              update("custom_auth_header", event.target.value)
            }
          />
        </label>
      )}
      {config.auth_type === "query_param" && (
        <label>
          Query 参数名称
          <input
            value={String(config.auth_query_param || "")}
            onChange={(event) => update("auth_query_param", event.target.value)}
          />
        </label>
      )}
      <div className="hub-form-wide hub-actions">
        {capabilities.map((cap) => (
          <label key={cap}>
            <input
              type="checkbox"
              checked={selected.includes(cap)}
              onChange={(event) =>
                update(
                  "capabilities",
                  event.target.checked
                    ? [...selected, cap]
                    : selected.filter((item) => item !== cap),
                )
              }
            />
            {capabilityLabels[cap]}
          </label>
        ))}
      </div>
      {capabilities
        .filter((cap) => selected.includes(cap))
        .map((cap) => (
          <label key={cap}>
            {capabilityLabels[cap]}默认模型
            <input
              value={String(config[`${cap}_model`] || "")}
              onChange={(event) => update(`${cap}_model`, event.target.value)}
            />
          </label>
        ))}
      <label>
        超时（ms）
        <input
          type="number"
          min={30000}
          max={600000}
          value={Number(config.timeout_ms || 120000)}
          onChange={(event) => update("timeout_ms", Number(event.target.value))}
        />
      </label>
      <label>
        并发上限
        <input
          type="number"
          min={1}
          max={8}
          value={Number(config.max_concurrency || 3)}
          onChange={(event) =>
            update("max_concurrency", Number(event.target.value))
          }
        />
      </label>
      <label>
        <span>启用</span>
        <input
          type="checkbox"
          checked={config.enabled !== false}
          onChange={(event) => update("enabled", event.target.checked)}
        />
      </label>
      {credentials && <div className="hub-form-wide">{credentials}</div>}
      <div className="hub-form-wide">
        <button className="hub-primary" onClick={onSave}>
          保存配置
        </button>
      </div>
    </fieldset>
  );
}
