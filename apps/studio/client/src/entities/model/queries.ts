import type { CapabilityModelCatalogOptions } from "./model";

export const modelQueryKeys = {
  all: ["models"] as const,
  endpoint: () => [...modelQueryKeys.all, "endpoint", "ai-models"] as const,
  catalog: () => [...modelQueryKeys.endpoint(), "catalog"] as const,
  capability: (
    capability: "text" | "image" | "video" | "audio",
    options: CapabilityModelCatalogOptions = {}
  ) =>
    [
      ...modelQueryKeys.endpoint(),
      "capability",
      capability,
      {
        includeGenericModels: options.includeGenericModels ?? true,
        normalizeMetadata: options.normalizeMetadata ?? true,
      },
    ] as const,
};
