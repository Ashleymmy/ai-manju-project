import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "@/shared/api/http";
import { fetchGenerationRecovery, resumeGenerationRecovery } from "./generationRecoveryApi";

vi.mock("@/shared/api/http", () => ({ request: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe("original generation recovery API", () => {
  it("requests a bounded page and passes cancellation to the status read", async () => {
    const controller = new AbortController();
    await fetchGenerationRecovery(30, controller.signal);
    expect(request).toHaveBeenCalledWith("/api/admin/generation-recovery", {
      query: { limit: 30, offset: 30 }, signal: controller.signal,
    });
  });

  it("resumes an encoded original ID using only the expected checkpoint revision", async () => {
    await resumeGenerationRecovery("job/original", 7);
    expect(request).toHaveBeenCalledWith("/api/admin/generation-recovery/job%2Foriginal/resume", {
      method: "POST", body: { expected_revision: 7 },
    });
  });
});
