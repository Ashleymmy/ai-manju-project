import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ProviderHub,
  ProviderConfigForm,
  toConfigDocument,
  parseConfigDocument,
  type ProviderRecord,
} from "../src";
import "../src/styles.css";

const examples = [
  {
    id: "demo-text",
    name: "文本与图像服务",
    base_url: "https://example.invalid/v1",
    mode: "openai_compatible",
    provider_type: "openai_compatible",
    auth_type: "none",
    text_model: "demo-llm",
    image_model: "demo-image",
    capabilities: ["text", "image"],
    timeout_ms: 120000,
    max_concurrency: 3,
    enabled: true,
  },
  {
    id: "demo-video",
    name: "sdvideo",
    base_url: "sd-video://managed",
    capabilities: ["video"],
    enabled: true,
    sdvideo_models: [
      {
        key: "seedance-2.5",
        name: "Seedance 2.5",
        model_id: "demo-company-model",
        enabled: true,
        concurrency_limit: 3,
        version: 1,
        upstream_provider: "legacy_proxy",
      },
      {
        key: "seedance-2.0",
        name: "Seedance 2.0",
        model_id: "demo-external-model",
        enabled: false,
        concurrency_limit: 2,
        version: 1,
        upstream_provider: "tokenspace",
      },
    ],
  },
  {
    id: "demo-audio",
    name: "语音服务",
    base_url: "https://example.invalid/v1",
    auth_type: "none",
    audio_model: "demo-tts",
    capabilities: ["audio"],
    enabled: true,
  },
] as ProviderRecord[];
function Demo() {
  const [providers, setProviders] = useState(examples);
  const [draft, setDraft] = useState(examples[0]);
  const save = async (value: ProviderRecord) => {
    const validation = parseConfigDocument(
      JSON.stringify(toConfigDocument(value)),
    );
    if (!validation.ok) throw new Error(validation.error);
    const saved = { ...value, id: value.id || `demo-${Date.now()}` };
    setProviders((items) =>
      items.some((item) => item.id === saved.id)
        ? items.map((item) => (item.id === saved.id ? saved : item))
        : [...items, saved],
    );
    setDraft(saved);
    return true;
  };
  return (
    <>
      <p
        style={{
          margin: 0,
          padding: "12px 32px",
          background: "#fff5db",
          color: "#665115",
          fontFamily: "system-ui",
        }}
      >
        交互演示 · 数据仅在当前页面内存中保存，不连接任何真实 Provider。
      </p>
      <ProviderHub
        providers={providers}
        draft={draft}
        onSelect={setDraft}
        onCreate={() =>
          setDraft({ ...examples[0], id: "", name: "新 Provider" })
        }
        onReload={() => {
          setProviders(examples);
          setDraft(examples[0]);
        }}
        onSaveJSON={save}
        onSaveForm={() => save(draft)}
        onDraftChange={setDraft}
        onToggle={(provider) =>
          save({
            ...provider,
            enabled: !provider.enabled,
            ...(provider.sdvideo_models
              ? {
                  sdvideo_models: provider.sdvideo_models.map((model) => ({
                    ...model,
                    enabled: !provider.enabled,
                  })),
                }
              : {}),
          })
        }
        renderForm={() => (
          <ProviderConfigForm
            document={toConfigDocument(draft)}
            provider={draft}
            onChange={(document) => setDraft({ ...draft, ...document.config })}
            presets={[
              {
                id: "compatible",
                name: "OpenAI Compatible",
                config: {
                  base_url: "https://example.invalid/v1",
                  auth_type: "none",
                  capabilities: ["text", "image"],
                },
              },
            ]}
          />
        )}
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Demo />);
