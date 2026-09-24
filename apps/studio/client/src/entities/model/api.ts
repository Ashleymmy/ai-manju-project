import { modelDisplayName, pickDefaultImageModel, visibleImageModels } from "@/shared/lib/modelSelection";
import { request } from "@/shared/api/http";
import { replaceVideoModelProtocols } from "./videoProtocol";
import { replaceVideoModelDurations } from "./videoDuration";
import { replaceVideoModelCapabilities } from "./videoCapabilities";
import { replaceImageModelProtocols } from "./imageProtocol";

import type {
  AiModelsResponse,
  CapabilityModelCatalog,
  CapabilityModelCatalogOptions,
  ModelCatalog,
  ModelDescriptor,
} from "./model";

export async function fetchModelCatalog(): Promise<ModelCatalog> {
  const data = await request<AiModelsResponse>("/api/ai/models");
  const modelLabels = normalizeStringRecord(data.model_labels);
  replaceVideoModelProtocols(data.video_model_protocols, modelLabels);
  replaceVideoModelDurations(data.video_model_durations);
  replaceVideoModelCapabilities(data.video_model_capabilities);
  replaceImageModelProtocols(data.image_model_protocols);
  const models = normalizeModelList(data.models);
  const textModels = normalizeModelList(
    data.text_models ?? data.models
  );
  const agentTextModels =
    data.agent_text_models === undefined
      ? textModels
      : normalizeModelList(data.agent_text_models);
  const defaultTextModel = normalizeModelValue(data.default_text_model);
  const defaultImageModel = normalizeModelValue(data.default_image_model);
  const defaultVideoModel = normalizeModelValue(data.default_video_model);
  const defaultAudioModel = normalizeModelValue(data.default_audio_model);
  const imageModels = visibleImageModels(normalizeModelList([
    ...(data.image_models || []),
    ...(defaultImageModel ? [defaultImageModel] : []),
  ]));
  const videoModels = normalizeModelList([
    ...(data.video_models || []),
    ...(defaultVideoModel ? [defaultVideoModel] : []),
  ]);
  const audioModels = normalizeModelList([
    ...(data.audio_models || []),
    ...(defaultAudioModel ? [defaultAudioModel] : []),
  ]);
  return {
    models,
    textModels,
    agentTextModels,
    imageModels,
    videoModels,
    audioModels,
    defaultTextModel: preferredModel(defaultTextModel, textModels),
    defaultImageModel: pickDefaultImageModel(imageModels, defaultImageModel),
    defaultVideoModel: preferredModel(defaultVideoModel, videoModels),
    defaultAudioModel: preferredModel(defaultAudioModel, audioModels),
    modelLabels,
    modelProviderNames: normalizeStringRecord(data.model_provider_names),
  };
}

export async function fetchTextModelCatalog(
  options: CapabilityModelCatalogOptions = {}
): Promise<CapabilityModelCatalog> {
  const { includeGenericModels = true, normalizeMetadata = true } = options;
  const data = await request<AiModelsResponse>("/api/ai/models");
  const defaultModel = normalizeModelValue(data.default_text_model);
  const models = normalizeModelList([
    ...(data.text_models || []),
    ...(includeGenericModels ? data.models || [] : []),
    ...(defaultModel ? [defaultModel] : []),
  ]);
  return {
    models,
    defaultModel: preferredModel(defaultModel, models),
    labels: modelMetadata(data.model_labels, normalizeMetadata),
    providerNames: modelMetadata(data.model_provider_names, normalizeMetadata),
  };
}

export async function fetchImageModelCatalog(
  options: Pick<CapabilityModelCatalogOptions, "normalizeMetadata"> = {}
): Promise<CapabilityModelCatalog> {
  const { normalizeMetadata = true } = options;
  const data = await request<AiModelsResponse>("/api/ai/models");
  replaceImageModelProtocols(data.image_model_protocols);
  const defaultModel = normalizeModelValue(data.default_image_model);
  const models = visibleImageModels(normalizeModelList([
    ...(data.image_models || []),
    ...(defaultModel ? [defaultModel] : []),
  ]));
  return {
    models,
    defaultModel: pickDefaultImageModel(models, defaultModel),
    labels: modelMetadata(data.model_labels, normalizeMetadata),
    providerNames: modelMetadata(data.model_provider_names, normalizeMetadata),
  };
}

export function normalizeModelList(value?: ModelDescriptor[]) {
  return Array.from(
    new Set((value || []).map(normalizeModelValue).filter(Boolean))
  );
}

export function modelLabel(
  model: string,
  catalog?: Pick<CapabilityModelCatalog, "labels" | "providerNames">
) {
  return modelDisplayName(model, catalog?.labels);
}

function normalizeModelValue(value?: ModelDescriptor) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return (value.id || value.name || "").trim();
}

function normalizeStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [
        key.trim(),
        typeof item === "string" ? item.trim() : "",
      ])
      .filter(([key, item]) => key && item)
  ) as Record<string, string>;
}

function modelMetadata(
  value: Record<string, string> | undefined,
  normalize: boolean
) {
  return normalize ? normalizeStringRecord(value) : value || {};
}

function preferredModel(preferred: string, models: string[]) {
  return preferred && models.includes(preferred) ? preferred : models[0] || "";
}
