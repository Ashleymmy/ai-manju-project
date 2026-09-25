import { describe, expect, it } from "vitest";

import {
  canvasPendingAudioUploadDescriptor,
  canvasPendingAudioUploadKey,
} from "./pendingAudioUpload";

describe("pending canvas audio uploads", () => {
  it("isolates a retained result by user, workspace, project, node, and attempt", () => {
    const first = canvasPendingAudioUploadKey(
      "user-a",
      "personal",
      "personal:project-1",
      "node-1",
      "attempt-1"
    );
    const otherUser = canvasPendingAudioUploadKey(
      "user-b",
      "personal",
      "personal:project-1",
      "node-1",
      "attempt-1"
    );
    const otherAttempt = canvasPendingAudioUploadKey(
      "user-a",
      "personal",
      "personal:project-1",
      "node-1",
      "attempt-2"
    );
    expect(first).not.toBe(otherUser);
    expect(first).not.toBe(otherAttempt);
    expect(first).toContain("user-a");
  });

  it("exposes only JSON-safe metadata in a canvas snapshot descriptor", () => {
    const pending = {
      key: "k",
      userId: "user-a",
      workspace: "personal" as const,
      projectId: "project-1",
      projectKey: "personal:project-1",
      nodeId: "node-1",
      originNodeId: "source-1",
      scope: "personal" as const,
      prompt: "旁白",
      config: {
        model: "tts",
        voice: "alloy" as const,
        format: "mp3" as const,
        speed: "1",
        instructions: "",
      },
      blob: new Blob(["audio"], { type: "audio/mpeg" }),
      fileName: "voice.mp3",
      contentType: "audio/mpeg",
      bytes: 5,
      createdAt: "2026-09-25T00:00:00.000Z",
      attemptId: "attempt-1",
    };
    expect(canvasPendingAudioUploadDescriptor(pending)).toEqual({
      key: "k",
      fileName: "voice.mp3",
      contentType: "audio/mpeg",
      bytes: 5,
      createdAt: "2026-09-25T00:00:00.000Z",
    });
  });
});
