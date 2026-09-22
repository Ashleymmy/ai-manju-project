import { modelName } from "@/shared/lib/modelSelection";

// Use the exact provider selector: administrators can override a model's protocol.
let protocols: Record<string, string> = {};
const DETAIL_PROTOCOLS = new Set(["openai_images", "openai_responses"]);
const IMAGE_PROTOCOLS = new Set([...DETAIL_PROTOCOLS, "openai_chat_completions", "gemini_generate_content", "dashscope_multimodal", "stability_image"]);

export function replaceImageModelProtocols(value: unknown) {
  protocols = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, protocol] of Object.entries(value)) {
      if (typeof protocol === "string" && IMAGE_PROTOCOLS.has(protocol)) protocols[key.trim()] = protocol;
    }
  }
}

export function imageModelSupportsDetail(model: string) {
  const protocol = protocols[model.trim()];
  if (protocol) return DETAIL_PROTOCOLS.has(protocol);
  // Preserve older catalogs while matching the API's Gemini/Banana auto routing.
  return !/gemini|banana/i.test(modelName(model));
}
