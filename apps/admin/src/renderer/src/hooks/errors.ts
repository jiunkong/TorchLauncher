import type { StudioImageFailure } from '../../../shared/studio';
import { formatBytes } from '../format';
import type { StudioRun } from './useStudio';

const detailKeys = {
  NO_TEST_RESULT: 'settings.import.error.NO_TEST_RESULT',
  TEST_OPTIONS_MISSING: 'settings.import.error.TEST_OPTIONS_MISSING',
} as const;
export type DetailMessageKey = (typeof detailKeys)[keyof typeof detailKeys];

/** Catalog key for a main-process detail code, or null when the generic error text applies. */
export function detailMessageKey(code: string | null): DetailMessageKey | null {
  return code !== null && code in detailKeys ? detailKeys[code as keyof typeof detailKeys] : null;
}

/** The message key for a failed options import (detail text, else the generic invalid input). */
export function importFailureKey(run: StudioRun | null): DetailMessageKey | 'error.INVALID' | null {
  if (run?.action !== 'settingsImportOptions' || run.ok || run.code === 'CANCELLED') return null;
  return detailMessageKey(run.detailCode) ?? 'error.INVALID';
}

/** Accepts the catalog translator; keys are built from the structured cause. */
type AnyTranslate = (key: never, values?: never) => string;
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** The concrete message for a failed branding image import, assembled from the structured cause. */
export function imageFailureMessage(image: StudioImageFailure, translate: AnyTranslate): string {
  const tr = translate as unknown as Translate;
  const role = tr(image.role === 'icon' ? 'brand.icon' : 'brand.background');
  switch (image.reason) {
    case 'unsupported':
      return tr('brand.error.unsupported', { name: image.name });
    case 'corrupt':
      if (image.part === 'empty') return tr('brand.error.corrupt.empty', { name: image.name });
      if (image.part === 'header' && image.format)
        return tr('brand.error.corrupt.header', { name: image.name, format: image.format });
      if (image.part === 'data' && image.format && image.width && image.height)
        return tr('brand.error.corrupt.data', {
          name: image.name,
          format: image.format,
          width: image.width,
          height: image.height,
        });
      return tr('brand.error.corrupt.unknown', { name: image.name });
    case 'fileTooLarge':
      return tr('brand.error.fileTooLarge', {
        name: image.name,
        size: formatBytes(image.bytes),
        limit: formatBytes(image.limit),
      });
    case 'tooManyPixels':
      return tr('brand.error.tooManyPixels', {
        name: image.name,
        width: image.width,
        height: image.height,
        megapixels: ((image.width * image.height) / 1_000_000).toFixed(1),
        limit: Math.round(image.limit / 1_000_000),
      });
    case 'cannotFit':
      return tr('brand.error.cannotFit', {
        name: image.name,
        attempts: image.attempts,
        width: image.width,
        height: image.height,
        size: formatBytes(image.bytes),
        limit: formatBytes(image.limit),
        role,
      });
    case 'unreadable':
      return tr(`brand.error.unreadable.${image.cause}`, { name: image.name });
    case 'storeFailed':
      return tr(`brand.error.store.${image.cause}`, { role });
  }
}
