import { describe, expect, it } from "vitest";

import {
  extraAgentModels,
  featuredAgentModels,
  isGpt56LunaModel,
  pickAgentDefaultModel,
} from "./agentModelPrefs";

describe("Agent model preferences", () => {
  it("recognizes gpt-5.6 luna by id or spaced label", () => {
    expect(isGpt56LunaModel("provider::gpt-5.6-luna")).toBe(true);
    expect(isGpt56LunaModel("gpt-5.6-sol", "gpt 5.6 luna")).toBe(true);
    expect(isGpt56LunaModel("gpt-5.5")).toBe(false);
  });

  it("defaults the selector to gpt-5.6 luna even when it is not the API default", () => {
    const models = ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra", "gpt-5.6-luna", "gpt-5.5"];
    expect(pickAgentDefaultModel(models, {}, "gpt-5.6-sol")).toBe("gpt-5.6-luna");
  });

  it("falls back to the API default when luna is absent", () => {
    const models = ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5"];
    expect(pickAgentDefaultModel(models, {}, "gpt-5.5")).toBe("gpt-5.5");
  });

  it("pins luna into the featured list so it is not buried under more models", () => {
    const models = ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra", "gpt-5.6-luna", "gpt-5.5"];
    const featured = featuredAgentModels(models, "gpt-5.6-luna");
    expect(featured).toEqual(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]);
    expect(extraAgentModels(models, featured)).toEqual(["gpt-6-astra", "gpt-5.5"]);
  });
});
