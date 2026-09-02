import { describe, expect, it } from "vitest";

import {
  DIRECTOR_PROTOCOL_VERSION,
  isDirectorResponse,
  normalizeDirectorFrame,
} from "./protocol";

describe("Director protocol adapter", () => {
  it("accepts only the current response envelope", () => {
    expect(
      isDirectorResponse({
        protocolVersion: DIRECTOR_PROTOCOL_VERSION,
        requestId: "request-1",
        action: "project.get",
        ok: true,
      })
    ).toBe(true);
    expect(
      isDirectorResponse({
        protocolVersion: 2,
        requestId: "request-1",
        action: "project.get",
        ok: true,
      })
    ).toBe(false);
    expect(
      isDirectorResponse({
        protocolVersion: DIRECTOR_PROTOCOL_VERSION,
        requestId: 1,
        ok: true,
      })
    ).toBe(false);
  });

  it("normalizes camelCase and snake_case frame exports", () => {
    expect(
      normalizeDirectorFrame({
        dataUrl: "data:image/png;base64,AA==",
        width: "1920",
        height: 1080,
        fileName: "camera.png",
      })
    ).toEqual({
      dataUrl: "data:image/png;base64,AA==",
      width: 1920,
      height: 1080,
      fileName: "camera.png",
    });
    expect(
      normalizeDirectorFrame({
        data_url: "data:image/webp;base64,AA==",
        file_name: "camera.webp",
      })
    ).toEqual({
      dataUrl: "data:image/webp;base64,AA==",
      width: undefined,
      height: undefined,
      fileName: "camera.webp",
    });
    expect(normalizeDirectorFrame(null)).toEqual({});
  });
});
