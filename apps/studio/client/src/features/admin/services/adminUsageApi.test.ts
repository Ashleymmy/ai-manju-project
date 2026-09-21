import { describe, expect, it } from "vitest";
import { costMoney, parseCostMicros } from "./adminUsageApi";

describe("platform cost precision", () => {
  it("retains fractions of a cent and distinguishes unknown from a confirmed zero", () => {
    expect(parseCostMicros("0.000001")).toBe(1);
    expect(parseCostMicros("1.234567")).toBe(1234567);
    expect(parseCostMicros("0")).toBe(0);
    expect(costMoney(null)).toBe("待核对");
    expect(costMoney(0)).not.toBe("待核对");
  });
  it("rejects negative, imprecise, unsafe, and non-decimal amounts", () => {
    for (const value of ["", "-1", "Infinity", "1e6", "1.1234567", "1000001", "9007199254740992"]) expect(parseCostMicros(value)).toBeNull();
  });
});
