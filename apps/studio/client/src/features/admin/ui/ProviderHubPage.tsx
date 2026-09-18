import {
  ProviderConfigForm,
  ProviderHub,
  mergeConfigDocument,
  toConfigDocument,
  type ProviderPreset,
} from "@ai-manju/provider-hub";
import "@ai-manju/provider-hub/styles.css";
import "./provider-hub-page.css";
import { ArrowLeft, KeyRound, TestTube2 } from "lucide-react";
import { Link } from "wouter";
import { useModelProvidersController } from "../controllers/useModelProvidersController";
import { emptyProvider } from "../model/provider";

export default function ProviderHubPage() {
  const controller = useModelProvidersController(true);
  const { providerDraft: draft, selectedPreset, activeProvider } = controller;
  const presets: ProviderPreset[] = controller.presets.map(preset => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    config: {
      preset_id: preset.id,
      provider_type: preset.provider_type,
      mode: preset.mode,
      base_url: preset.base_url,
      auth_type: preset.auth_type,
      custom_auth_header: preset.custom_auth_header || "",
      auth_query_param: preset.auth_query_param || "",
      capabilities: preset.capabilities,
      models_by_capability: preset.models_by_capability,
      text_model: preset.defaults.text || "",
      image_model: preset.defaults.image || "",
      video_model: preset.defaults.video || "",
      audio_model: preset.defaults.audio || "",
      endpoint_overrides: preset.endpoint_overrides || {},
      extra_headers: preset.extra_headers || {},
    },
  }));
  return (
    <div className="provider-hub-page">
      <ProviderHub
        providers={controller.providers}
        draft={draft}
        busy={Boolean(controller.busy)}
        loading={controller.isPending}
        error={controller.loadError}
        navigation={
          <Link href="/admin" className="hub-navigation" title="返回管理后台">
            <ArrowLeft size={16} />
            <span>管理后台</span>
          </Link>
        }
        onSelect={controller.selectProvider}
        onCreate={capability => {
          controller.createProviderDraft();
          controller.setProviderDraft({
            ...emptyProvider,
            name: "",
            capabilities: [capability || "text"],
          });
        }}
        onReload={() => void controller.reload()}
        onSaveJSON={controller.saveProvider}
        onSaveForm={() => controller.saveProvider()}
        onDraftChange={controller.setProviderDraft}
        onToggle={controller.toggleProvider}
        onDuplicate={controller.createProviderDraft}
        onRemove={controller.removeProvider}
        onDismiss={() => {
          controller.clearSensitiveInputs();
          controller.setProviderTestConfirmOpen(false);
        }}
        credentialsDirty={Boolean(
          controller.apiKey ||
          Object.values(controller.providerSecrets).some(Boolean)
        )}
        renderForm={() => (
          <>
            <ProviderConfigForm
              document={toConfigDocument(draft)}
              provider={draft}
              onChange={document =>
                controller.setProviderDraft(current =>
                  mergeConfigDocument(current, document)
                )
              }
              busy={Boolean(controller.busy)}
              presets={presets}
              onPresetChange={controller.clearSensitiveInputs}
              onFetchModels={() => void controller.fetchModels()}
              credentials={
                <>
                  <label className="hub-field-wide">
                    <span>
                      <KeyRound size={14} /> API Key
                    </span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={controller.apiKey}
                      onChange={event =>
                        controller.setApiKey(event.target.value)
                      }
                      placeholder={
                        activeProvider?.api_key_configured ||
                        activeProvider?.api_key_set
                          ? "已配置，留空保留当前密钥"
                          : "填写服务商提供的 API Key"
                      }
                    />
                  </label>
                  {selectedPreset?.secrets?.map(secret => (
                    <label key={secret.key}>
                      {secret.label}
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={controller.providerSecrets[secret.key] || ""}
                        onChange={event =>
                          controller.setProviderSecrets(current => ({
                            ...current,
                            [secret.key]: event.target.value,
                          }))
                        }
                        placeholder={
                          activeProvider?.secrets_set?.[secret.key]
                            ? "已配置，留空保留当前值"
                            : secret.placeholder || "填写凭据"
                        }
                      />
                    </label>
                  ))}
                </>
              }
            />
            {!draft.sdvideo_models && (
              <section className="hub-connection-test">
                <button
                  type="button"
                  disabled={Boolean(controller.busy)}
                  onClick={controller.testProvider}
                >
                  <TestTube2 size={16} />
                  测试连接
                </button>
                {controller.providerTestConfirmOpen && (
                  <div className="hub-inline-confirm">
                    <p>将发送一次简短的文本测试请求，可能产生少量费用。</p>
                    <button
                      type="button"
                      onClick={() =>
                        controller.setProviderTestConfirmOpen(false)
                      }
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => void controller.runProviderTest()}
                    >
                      确认测试
                    </button>
                  </div>
                )}
                {controller.providerTestResult && (
                  <p
                    role="status"
                    className={
                      controller.providerTestResult.ok === false
                        ? "hub-error"
                        : "hub-valid"
                    }
                  >
                    {controller.providerTestResult.message ||
                      controller.providerTestResult.error ||
                      controller.providerTestResult.text ||
                      "测试完成"}
                  </p>
                )}
              </section>
            )}
          </>
        )}
      />
    </div>
  );
}
