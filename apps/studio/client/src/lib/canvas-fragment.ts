// Compatibility forwarder. Remove after all callers move to the Canvas feature boundary.
export * from "@/features/canvas/domain/fragment";

import {
  importCanvasFragmentPackage as importDomainCanvasFragmentPackage,
  parseCanvasFragmentPackage as parseDomainCanvasFragmentPackage,
} from "@/features/canvas/domain/fragment";

export function parseCanvasFragmentPackage(value: unknown) {
  return parseDomainCanvasFragmentPackage(value, () => crypto.randomUUID());
}

type CompatibilityImportInput = Omit<
  Parameters<typeof importDomainCanvasFragmentPackage>[0],
  "createDirectorInstanceId"
> & {
  createDirectorInstanceId?: () => string;
};

export function importCanvasFragmentPackage(input: CompatibilityImportInput) {
  return importDomainCanvasFragmentPackage({
    ...input,
    createDirectorInstanceId:
      input.createDirectorInstanceId ?? (() => `director-${crypto.randomUUID()}`),
  });
}
