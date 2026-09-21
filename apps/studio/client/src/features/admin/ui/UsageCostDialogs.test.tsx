// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageCostDialog } from "./UsageCostDialogs";
import { saveActualCost, type UsageRow } from "../services/adminUsageApi";

vi.mock("../services/adminUsageApi", async importOriginal => ({
  ...await importOriginal<typeof import("../services/adminUsageApi")>(),
  saveActualCost: vi.fn(),
}));

describe("actual cost reconciliation form", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onSaved = vi.fn(async () => {});
  const onClose = vi.fn();
  const task = { job_id: "test-job", model: "test-model", actual_cost_micros: 0, cost_reference: "invoice-1" } as UsageRow;
  const saveButton = () => [...document.querySelectorAll("button")].find(button => button.textContent === "保存")!;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  const render = async (value: UsageRow) => act(async () => root.render(<UsageCostDialog task={value} onSaved={onSaved} onClose={onClose} />));

  it("requires an invoice reference even when the confirmed fee is zero", async () => {
    await render({ ...task, cost_reference: "" });
    await act(async () => saveButton().click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("核对依据");
    expect(saveActualCost).not.toHaveBeenCalled();
  });

  it("keeps a failed reconciliation editable and retries the total without incrementing it", async () => {
    vi.mocked(saveActualCost).mockRejectedValueOnce(new Error("network interrupted"));
    await render(task);
    await act(async () => saveButton().click());
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => saveButton().click());
    expect(saveActualCost).toHaveBeenNthCalledWith(1, "test-job", 0, "invoice-1");
    expect(saveActualCost).toHaveBeenNthCalledWith(2, "test-job", 0, "invoice-1");
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
