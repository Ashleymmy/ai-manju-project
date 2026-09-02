export const DIRECTOR_PROTOCOL_VERSION = 1;
export const DIRECTOR_REQUEST_TYPE = "storyai:director-desk:request";
export const DIRECTOR_RESPONSE_TYPE = "storyai:director-desk:response";
export const DIRECTOR_READY_TYPE = "storyai:director-desk-ready";
export const DIRECTOR_SESSION_TYPE = "storyai:director-desk-session";

export type DirectorAction =
  | "capabilities.get"
  | "project.get"
  | "timeline.get"
  | "export.frame"
  | "export.video"
  | "plugin.result.submit"
  | "plugin.results.list";

export type RequestDirector = (
  action: DirectorAction,
  options?: Record<string, unknown>
) => Promise<unknown>;

export type DirectorResponse = {
  protocolVersion: number;
  requestId: string;
  action: DirectorAction | "unknown";
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
};

export type DirectorFrameExport = {
  dataUrl?: string;
  width?: number;
  height?: number;
  fileName?: string;
};

export function isDirectorResponse(value: unknown): value is DirectorResponse {
  if (!isRecord(value)) return false;
  return (
    value.protocolVersion === DIRECTOR_PROTOCOL_VERSION &&
    typeof value.requestId === "string" &&
    typeof value.ok === "boolean"
  );
}

export function normalizeDirectorFrame(data: unknown): DirectorFrameExport {
  if (!isRecord(data)) return {};
  return {
    dataUrl:
      typeof data.dataUrl === "string"
        ? data.dataUrl
        : typeof data.data_url === "string"
          ? data.data_url
          : "",
    width: Number(data.width) || undefined,
    height: Number(data.height) || undefined,
    fileName:
      typeof data.fileName === "string"
        ? data.fileName
        : typeof data.file_name === "string"
          ? data.file_name
          : "director-frame.png",
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
