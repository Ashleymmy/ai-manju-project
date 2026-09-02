import type {
  ComicAssetClass,
  ComicAssetInput,
} from "@/services/api/comic-assets";

export type ComicImportCandidate = ComicAssetInput & {
  key: string;
  code: string;
  class: ComicAssetClass;
  name: string;
  state: string;
  description: string;
  visual_description: string;
  change_request: string;
  source_prompt: string;
  prompt_template: string;
  archive_status: string;
};

export const COMIC_SOURCE_MAX_BYTES: number;
export const COMIC_SCRIPT_MAX_CHARS: number;
export const COMIC_IMPORT_MAX_ASSETS: number;

export function extractComicScript(
  file: File,
): Promise<{ text: string; truncated: boolean }>;
export function parseComicWorkbook(file: File): Promise<ComicImportCandidate[]>;
export function parseComicAiCandidates(raw: string): ComicImportCandidate[];
export function createEmptyComicCandidate(
  assetClass?: ComicAssetClass,
): ComicImportCandidate;
