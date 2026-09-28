// Browsers may omit ZIP MIME types or use Windows' compressed-folder type.
const ZIP_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip",
  "application/x-zip-compressed",
]);

/** Route ZIP candidates to the package reader, which validates their contents. */
export function isAssetPackageFile(file: Pick<File, "name" | "type">): boolean {
  return /\.zip$/i.test(file.name) || ZIP_MIME_TYPES.has(file.type.toLowerCase());
}
