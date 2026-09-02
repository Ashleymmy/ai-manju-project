export function createBrowserFile(blob: Blob, name: string, mime: string) {
  return new File([blob], name, { type: mime });
}
