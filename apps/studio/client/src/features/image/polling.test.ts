// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForImageJob } from "./api";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("accepted image task status queries", () => {
  it.each([408, 429, 503])("keeps the accepted job after HTTP %s and resumes polling", async status => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, error: "temporary" }), { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { id: "job-one", type: "image.generate", status: "succeeded" } })));
    vi.stubGlobal("fetch", fetch);
    const pending = waitForImageJob("job-one");
    await vi.advanceTimersByTimeAsync(2500);
    expect(await pending).toMatchObject({ id: "job-one", status: "succeeded" });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetch.mock.calls) {
      expect(String(url)).toContain("/api/jobs/job-one");
      expect(options.method).toBeUndefined();
    }
  });
});
