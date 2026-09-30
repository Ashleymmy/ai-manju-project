import { describe, expect, it } from "vitest";
import { replaceImageModelProtocols } from "@/entities/model/imageProtocol";
import { creationBudgetEstimate, creationBudgetSpecs } from "./creationBudget";

const quote = (credits: number) => ({ credits, params: { pricing_source: "membership_price_sheet" } });
describe("creation budget", () => {
  it("uses the rounded single-image quote and floors affordable output", () => {
    expect(creationBudgetEstimate(600, quote(23))).toMatchObject({ count: 26, credits: 23 });
    expect(creationBudgetEstimate(22, quote(23))).toMatchObject({ count: 0 });
    expect(creationBudgetEstimate(0, quote(23))).toMatchObject({ count: 0 });
  });
  it.each([undefined, NaN, Infinity, -1])("does not invent a missing/invalid balance %s", available => {
    expect(creationBudgetEstimate(available, quote(10)).count).toBeUndefined();
  });
  it.each([0, -1, NaN, Infinity])("does not present an unbounded or invalid quote %s as output", price => {
    expect(creationBudgetEstimate(600, quote(price)).count).toBeUndefined();
  });
  it("requires a precise model quote, not a range or fallback", () => {
    expect(creationBudgetEstimate(600, undefined).count).toBeUndefined();
    expect(creationBudgetEstimate(600, { credits: 20, params: { pricing_source: "legacy" } }).count).toBeUndefined();
    expect(creationBudgetEstimate(600, { ...quote(20), params: { ...quote(20).params, range_min: 10, range_max: 30 } }).count).toBeUndefined();
  });
  it("uses the configured protocol and does not offer detail tiers on resolution-only models", () => {
    replaceImageModelProtocols({ "custom::image": "gemini_generate_content", "other::image": "openai_images" });
    expect(creationBudgetSpecs("custom::image")).toEqual([{ value: "auto", label: "1K · 标准" }]);
    expect(creationBudgetSpecs("other::image").map(spec => spec.value)).toEqual(["low", "medium", "high"]);
    expect(creationBudgetSpecs("")).toEqual([]);
    replaceImageModelProtocols({});
  });
});
