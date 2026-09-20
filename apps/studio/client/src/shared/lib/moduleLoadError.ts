/** Match module transport failures only, never ordinary API or render errors. */
export function isModuleLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (?:CSS )?chunk [\w-]+ failed/i.test(error.message);
}
