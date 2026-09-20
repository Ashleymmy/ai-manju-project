export type VideoModelProtocol = "seedance" | "openai";

// Updated atomically with the catalog. Key by the full provider selector so an
// opaque endpoint in one provider cannot change another provider's protocol.
let protocols: Record<string, VideoModelProtocol> = {};
let labels: Record<string, string> = {};

export function replaceVideoModelProtocols(value: unknown, modelLabels?: Record<string, string>) {
  labels = { ...modelLabels };
  protocols = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, protocol] of Object.entries(value)) {
      if (protocol === "seedance" || protocol === "openai") protocols[key] = protocol;
    }
  }
  return { ...protocols };
}

export function videoModelProtocol(model: string): VideoModelProtocol | undefined {
  return protocols[model.trim()];
}

/** Endpoint IDs are opaque; use only the label for this exact provider selector. */
export function videoModelLabel(model: string): string | undefined {
  return labels[model.trim()];
}
