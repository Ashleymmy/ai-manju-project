export type ModelDescriptor = string | { id?: string; name?: string };

export type AiModelsResponse = {
  text_models?: ModelDescriptor[];
  agent_text_models?: ModelDescriptor[];
  image_models?: ModelDescriptor[];
  video_models?: ModelDescriptor[];
  audio_models?: ModelDescriptor[];
  models?: ModelDescriptor[];
  default_text_model?: ModelDescriptor;
  default_image_model?: ModelDescriptor;
  default_video_model?: ModelDescriptor;
  default_audio_model?: ModelDescriptor;
  model_labels?: Record<string, string>;
  model_provider_names?: Record<string, string>;
};

export type CapabilityModelCatalog = {
  models: string[];
  defaultModel: string;
  labels: Record<string, string>;
  providerNames: Record<string, string>;
};

export type CapabilityModelCatalogOptions = {
  includeGenericModels?: boolean;
  normalizeMetadata?: boolean;
};

export type ModelCatalog = {
  models: string[];
  textModels: string[];
  agentTextModels: string[];
  imageModels: string[];
  videoModels: string[];
  audioModels: string[];
  defaultTextModel: string;
  defaultImageModel: string;
  defaultVideoModel: string;
  defaultAudioModel: string;
  modelLabels: Record<string, string>;
  modelProviderNames: Record<string, string>;
};
