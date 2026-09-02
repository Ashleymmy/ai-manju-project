import {
  CopyPlus,
  Hash,
  KeyRound,
  Plus,
  RefreshCcw,
  Save,
  ServerCog,
  TestTube2,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import type { ModelProvidersController } from "../controllers/useModelProvidersController";
import {
  capabilityOptions,
  imageProtocolOptions,
  joinModels,
  normalizeAliasMap,
  splitLines,
  splitModels,
} from "../model/provider";
import type {
  ImageGenerationProtocol,
  ModelProviderConfig,
} from "../services/adminApi";

export function ProvidersPanel({
  controller,
}: {
  controller: ModelProvidersController;
}) {
  const {
    activeProvider,
    apiKey,
    busy,
    changePreset,
    configuredModelIds,
    confirmDelete: confirmProviderDelete,
    createProviderDraft,
    deleteBusy: providerDeleteBusy,
    deleteError: providerDeleteError,
    deleteOpen: providerDeleteOpen,
    deleteTarget: providerDeleteTarget,
    fetchModels,
    openDeleteDialog: openProviderDeleteDialog,
    closeDeleteDialog: closeProviderDeleteDialog,
    presets,
    protocolModelIds,
    providerDraft,
    providers,
    providerSecrets,
    providerTestConfirmOpen,
    providerTestResult,
    runProviderTest,
    saveProvider,
    selectProvider,
    selectedPreset,
    setApiKey,
    setDeleteOpen: setProviderDeleteOpen,
    setProviderDraft,
    setProviderSecrets,
    setProviderTestConfirmOpen,
    testProvider,
  } = controller;

  return (
    <>
      <section className="real-admin-section provider-editor">
        <div className="admin-panel-head">
          <div>
            <p className="eyebrow">PROVIDERS / {providers.length}</p>
            <h2>模型提供商</h2>
          </div>
          <button
            className="vermilion-button"
            onClick={() => createProviderDraft()}
          >
            <Plus size={16} /> 新建 Provider
          </button>
        </div>
        <div className="provider-editor-layout">
          <aside className="provider-list compact">
            {providers.map(provider => (
              <button
                className={
                  provider.id === activeProvider?.id ? "selected" : ""
                }
                key={provider.id}
                onClick={() => selectProvider(provider)}
              >
                <ServerCog size={17} />
                <span>
                  <b>{provider.name}</b>
                  <small>
                    {provider.provider_type} · {provider.capabilities?.join("/")}
                  </small>
                </span>
                <em className={provider.enabled ? "active" : "pending"}>
                  {provider.enabled ? "启用" : "停用"}
                </em>
              </button>
            ))}
          </aside>
          <section className="provider-form">
            <label>
              预设
              <select
                value={providerDraft.preset_id || ""}
                onChange={event => changePreset(event.target.value)}
              >
                <option value="">不使用预设</option>
                {presets.map(preset => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="provider-switch-label">
              启用
              <input
                type="checkbox"
                checked={providerDraft.enabled !== false}
                onChange={event =>
                  setProviderDraft(draft => ({
                    ...draft,
                    enabled: event.target.checked,
                  }))
                }
              />
            </label>
            <label>
              名称
              <input
                value={providerDraft.name || ""}
                onChange={event =>
                  setProviderDraft(draft => ({
                    ...draft,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Provider ID
              <input
                value={providerDraft.id || ""}
                disabled={Boolean(activeProvider?.id)}
                onChange={event =>
                  setProviderDraft(draft => ({
                    ...draft,
                    id: event.target.value,
                  }))
                }
                placeholder="留空自动生成"
              />
            </label>
            <label>
              Base URL
              <input
                value={providerDraft.base_url || ""}
                onChange={event =>
                  setProviderDraft(draft => ({
                    ...draft,
                    base_url: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              模式
              <select
                value={providerDraft.mode}
                onChange={event =>
                  setProviderDraft(draft => ({
                    ...draft,
                    mode: event.target.value as ModelProviderConfig["mode"],
                  }))
                }
              >
                <option value="openai_compatible">OpenAI Compatible</option>
                <option value="local_openai">Local OpenAI</option>
              </select>
            </label>
            <label>
              Provider 类型
              <select
                value={providerDraft.provider_type || "openai_compatible"}
                onChange={event =>
                  setProviderDraft(draft => ({
                    ...draft,
                    provider_type: event.target.value as NonNullable<
                      ModelProviderConfig["provider_type"]
                    >,
                  }))
                }
              >
                <option value="openai_compatible">openai_compatible</option>
                <option value="volcengine_ark">volcengine_ark</option>
                <option value="gemini_media">gemini_media</option>
                <option value="kling_video">kling_video</option>
                <option value="minimax_hailuo">minimax_hailuo</option>
                <option value="fal_happyhorse">fal_happyhorse</option>
                <option value="xai_imagine">xai_imagine</option>
                <option value="aliyun_yike">阿里云 Yike / Wan 视频</option>
              </select>
            </label>
            <label>
              鉴权方式
              <select
                value={providerDraft.auth_type}
                onChange={event =>
                  setProviderDraft(draft => ({
                    ...draft,
                    auth_type: event.target.value as ModelProviderConfig["auth_type"],
                  }))
                }
              >
                <option value="bearer">Bearer</option>
                <option value="x_api_key">X-API-Key</option>
                <option value="x_goog_api_key">Google API Key</option>
                <option value="auto_api_key">自动兼容 API Key</option>
                <option value="custom_header">自定义 Header</option>
                <option value="query_param">Query 参数</option>
                <option value="none">None</option>
              </select>
            </label>
            {providerDraft.auth_type === "custom_header" && (
              <label>
                自定义 Header
                <input
                  value={providerDraft.custom_auth_header || ""}
                  onChange={event =>
                    setProviderDraft(draft => ({
                      ...draft,
                      custom_auth_header: event.target.value,
                    }))
                  }
                  placeholder="X-API-Key"
                />
              </label>
            )}
            {providerDraft.auth_type === "query_param" && (
              <label>
                Query 参数
                <input
                  value={providerDraft.auth_query_param || ""}
                  onChange={event =>
                    setProviderDraft(draft => ({
                      ...draft,
                      auth_query_param: event.target.value,
                    }))
                  }
                  placeholder="key"
                />
              </label>
            )}
            <label>
              API Key
              <KeyRound size={13} />
              <input
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={event => setApiKey(event.target.value)}
                placeholder={
                  activeProvider?.api_key_configured
                    ? "留空则保留已有密钥"
                    : "保存或测试时可填入"
                }
              />
            </label>
            {selectedPreset?.secrets?.map(secret => (
              <label key={secret.key}>
                {secret.label}
                <input
                  type="password"
                  autoComplete="new-password"
                  value={providerSecrets[secret.key] || ""}
                  onChange={event =>
                    setProviderSecrets(current => ({
                      ...current,
                      [secret.key]: event.target.value,
                    }))
                  }
                  placeholder={
                    activeProvider?.secrets_set?.[secret.key]
                      ? "已配置，留空保持当前值"
                      : secret.placeholder || "请输入密钥"
                  }
                />
              </label>
            ))}
            <label>
              文本模型
              <input
                value={providerDraft.text_model || ""}
                onChange={event =>
                  setProviderDraft(draft => ({
                    ...draft,
                    text_model: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              图像模型
              <input
                value={providerDraft.image_model || ""}
                onChange={event =>
                  setProviderDraft(draft => ({
                    ...draft,
                    image_model: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              视频模型
              <input
                value={providerDraft.video_model || ""}
                onChange={event =>
                  setProviderDraft(draft => ({
                    ...draft,
                    video_model: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              音频模型
              <input
                value={providerDraft.audio_model || ""}
                onChange={event =>
                  setProviderDraft(draft => ({
                    ...draft,
                    audio_model: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              超时时间 ms
              <input
                type="number"
                min={30000}
                max={600000}
                step={1000}
                value={providerDraft.timeout_ms || 300000}
                onChange={event =>
                  setProviderDraft(draft => ({
                    ...draft,
                    timeout_ms: Number(event.target.value) || 300000,
                  }))
                }
              />
            </label>
            <label>
              并发上限
              <input
                type="number"
                min={1}
                max={8}
                value={providerDraft.max_concurrency || 1}
                onChange={event =>
                  setProviderDraft(draft => ({
                    ...draft,
                    max_concurrency: Number(event.target.value) || 1,
                  }))
                }
              />
            </label>
            <div className="provider-form-full provider-chip-section">
              <span>启用能力</span>
              {capabilityOptions.map(item => {
                const checked = (providerDraft.capabilities || []).includes(
                  item.value
                );
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={checked ? "active" : ""}
                    onClick={() =>
                      setProviderDraft(draft => ({
                        ...draft,
                        capabilities: checked
                          ? (draft.capabilities || []).filter(
                              value => value !== item.value
                            )
                          : [...(draft.capabilities || []), item.value],
                      }))
                    }
                  >
                    {item.label}
                  </button>
                );
              })}
              <span>默认入口</span>
              {capabilityOptions.map(item => {
                const checked = (providerDraft.default_for || []).includes(
                  item.value
                );
                return (
                  <button
                    key={`default-${item.value}`}
                    type="button"
                    className={checked ? "active" : ""}
                    onClick={() =>
                      setProviderDraft(draft => ({
                        ...draft,
                        default_for: checked
                          ? (draft.default_for || []).filter(
                              value => value !== item.value
                            )
                          : [...(draft.default_for || []), item.value],
                      }))
                    }
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className="provider-form-full">
              <div className="provider-section-head">
                <div>
                  <b>能力模型列表</b>
                  <small>
                    可手动输入模型 ID；逗号、分号或换行分隔。拉取模型不会覆盖手填项。
                  </small>
                </div>
                <span className="status-chip blue">
                  {configuredModelIds.length} 个模型
                </span>
              </div>
              <div className="provider-capability-grid">
                {capabilityOptions.map(item => (
                  <label key={item.value}>
                    {item.label}模型列表
                    <textarea
                      value={joinModels(
                        providerDraft.models_by_capability?.[item.value] || []
                      )}
                      onChange={event =>
                        setProviderDraft(draft => ({
                          ...draft,
                          models_by_capability: {
                            ...(draft.models_by_capability || {}),
                            [item.value]: splitModels(event.target.value),
                          },
                        }))
                      }
                      placeholder={`每行一个 ${item.label} 模型 ID`}
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="provider-form-full">
              <div className="provider-section-head">
                <div>
                  <b>模型显示名称映射</b>
                  <small>
                    格式：真实模型 ID = 显示名称。只影响下拉展示，不改变请求模型。
                  </small>
                </div>
                <Hash size={15} />
              </div>
              <textarea
                className="provider-map-textarea"
                value={Object.entries(providerDraft.model_aliases || {})
                  .map(([model, alias]) => `${model} = ${alias}`)
                  .join("\n")}
                onChange={event =>
                  setProviderDraft(draft => ({
                    ...draft,
                    model_aliases: normalizeAliasMap(
                      Object.fromEntries(
                        splitLines(event.target.value).map(line => {
                          const index = line.indexOf("=");
                          if (index < 0) return [line, line];
                          return [line.slice(0, index), line.slice(index + 1)];
                        })
                      )
                    ),
                  }))
                }
                placeholder={"wan3.0 = Wan 3.0\nbanana-pro = Banana Pro"}
              />
            </div>
            <div className="provider-form-full">
              <div className="provider-section-head">
                <div>
                  <b>图片模型调用协议</b>
                  <small>
                    按真实模型 ID 指定协议；中转站 Gemini / Banana 通常选择 OpenAI
                    Chat Completions。
                  </small>
                </div>
                <span className="status-chip blue">
                  {protocolModelIds.length} 个图片模型
                </span>
              </div>
              {protocolModelIds.length ? (
                <div className="provider-protocol-grid">
                  {protocolModelIds.map(modelID => (
                    <label key={modelID}>
                      <span>{modelID}</span>
                      <select
                        value={providerDraft.model_protocols?.[modelID] || "auto"}
                        onChange={event =>
                          setProviderDraft(draft => ({
                            ...draft,
                            model_protocols: {
                              ...(draft.model_protocols || {}),
                              [modelID]: event.target
                                .value as ImageGenerationProtocol,
                            },
                          }))
                        }
                      >
                        {imageProtocolOptions.map(protocol => (
                          <option key={protocol.value} value={protocol.value}>
                            {protocol.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="empty-output">
                  <p>请先拉取模型或填写图像模型。</p>
                </div>
              )}
            </div>
            <ProviderMapEditor
              title="Endpoint Overrides"
              description="格式：video_create = /contents/generations/tasks；每行一个覆盖路径。"
              value={providerDraft.endpoint_overrides || {}}
              placeholder={
                "video_create = /contents/generations/tasks\nvideo_get = /contents/generations/tasks/{id}"
              }
              onChange={endpoint_overrides =>
                setProviderDraft(draft => ({ ...draft, endpoint_overrides }))
              }
            />
            <ProviderMapEditor
              title="Extra Headers"
              description="格式：Header-Name = value；空项不会提交。"
              value={providerDraft.extra_headers || {}}
              placeholder={"X-Tenant = team-a\nX-Provider-Mode = production"}
              onChange={extra_headers =>
                setProviderDraft(draft => ({ ...draft, extra_headers }))
              }
            />
            <div className="provider-form-actions">
              <button
                className="outline-button small"
                onClick={() => void fetchModels()}
                disabled={busy === "provider-models"}
              >
                <RefreshCcw size={15} /> 拉取模型
              </button>
              <button
                className="outline-button small"
                onClick={testProvider}
                disabled={busy === "provider-test"}
              >
                <TestTube2 size={15} /> 测试连接
              </button>
              <button
                className="outline-button small"
                onClick={() => createProviderDraft(providerDraft)}
              >
                <CopyPlus size={15} /> 复制为新 Provider
              </button>
              <button
                className="outline-button small"
                onClick={openProviderDeleteDialog}
                disabled={
                  !activeProvider?.id ||
                  activeProvider.id === "default" ||
                  providerDeleteBusy
                }
              >
                删除 Provider
              </button>
              <button
                className="vermilion-button"
                onClick={() => void saveProvider()}
                disabled={busy === "provider-save"}
              >
                <Save size={16} /> 保存 Provider
              </button>
            </div>
            {providerTestResult ? (
              <div
                className={`provider-test-result ${
                  providerTestResult.ok === false ? "failed" : "passed"
                }`}
              >
                <b>
                  {providerTestResult.ok === false ? "测试失败" : "测试完成"}
                </b>
                <p>
                  {providerTestResult.message ||
                    providerTestResult.error ||
                    providerTestResult.text ||
                    "后端已返回测试结果。"}
                </p>
                {providerTestResult.text_ok !== undefined ? (
                  <small>
                    文本 ping：{providerTestResult.text_ok ? "成功" : "失败"}
                  </small>
                ) : null}
                {providerTestResult.model ? (
                  <small>使用模型：{providerTestResult.model}</small>
                ) : null}
                {providerTestResult.provider_config ? (
                  <small>
                    鉴权发送：
                    {providerTestResult.provider_config.auth_header || "无"} · API
                    Key：
                    {providerTestResult.provider_config.api_key_set
                      ? "已带入"
                      : "未带入"}
                  </small>
                ) : null}
                {providerTestResult.models_error ? (
                  <small>模型列表错误：{providerTestResult.models_error}</small>
                ) : null}
                {providerTestResult.text_error ? (
                  <small>文本测试错误：{providerTestResult.text_error}</small>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      </section>

      <AlertDialog
        open={providerDeleteOpen}
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            if (providerDeleteBusy) return;
            closeProviderDeleteDialog();
            return;
          }
          setProviderDeleteOpen(true);
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={event => {
            if (providerDeleteBusy) event.preventDefault();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Provider</AlertDialogTitle>
            <AlertDialogDescription>
              {providerDeleteTarget
                ? `确认删除 “${providerDeleteTarget.name}”（${providerDeleteTarget.id}）？此操作会移除后端管理配置。`
                : "请选择要删除的 Provider。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {providerDeleteError ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {providerDeleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={providerDeleteBusy}
              onClick={event => {
                if (providerDeleteBusy) event.preventDefault();
                else closeProviderDeleteDialog();
              }}
            >
              取消
            </AlertDialogCancel>
            <button
              className="vermilion-button"
              type="button"
              onClick={() => void confirmProviderDelete()}
              disabled={providerDeleteBusy || !providerDeleteTarget?.id}
            >
              {providerDeleteBusy ? "删除中…" : "确认删除"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={providerTestConfirmOpen}
        onOpenChange={setProviderTestConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>测试连接与文本模型</AlertDialogTitle>
            <AlertDialogDescription>
              本次测试会向当前默认文本模型发送一次 ping，可能产生少量模型费用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <button
              className="vermilion-button"
              type="button"
              onClick={() => void runProviderTest()}
              disabled={busy === "provider-test"}
            >
              确认测试
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ProviderMapEditor({
  description,
  onChange,
  placeholder,
  title,
  value,
}: {
  description: string;
  onChange: (value: Record<string, string>) => void;
  placeholder: string;
  title: string;
  value: Record<string, string>;
}) {
  return (
    <div className="provider-form-full">
      <div className="provider-section-head">
        <div>
          <b>{title}</b>
          <small>{description}</small>
        </div>
        <Hash size={15} />
      </div>
      <textarea
        className="provider-map-textarea"
        value={Object.entries(value)
          .map(([key, item]) => `${key} = ${item}`)
          .join("\n")}
        onChange={event =>
          onChange(
            normalizeAliasMap(
              Object.fromEntries(
                splitLines(event.target.value).map(line => {
                  const index = line.indexOf("=");
                  if (index < 0) return [line, ""];
                  return [line.slice(0, index), line.slice(index + 1)];
                })
              )
            )
          )
        }
        placeholder={placeholder}
      />
    </div>
  );
}
