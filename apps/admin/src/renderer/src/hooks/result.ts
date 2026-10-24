import type { createTranslator } from '@torchlauncher/core/i18n';
import type { StudioResult } from '../../../shared/studio.js';
import type { studioTranslations } from '../i18n/catalog.js';

type Translate = ReturnType<typeof createTranslator<typeof studioTranslations>>;

export function studioResultMessage(result: StudioResult | null, t: Translate): string {
  if (!result) return '';
  switch (result.key) {
    case 'projectSaved':
      return t('result.projectSaved');
    case 'signingKeyCreated':
      return t('result.signingKeyCreated');
    case 'signingKeyBackupSaved':
      return t('result.signingKeyBackupSaved');
    case 'signingKeyRestored':
      return t('result.signingKeyRestored');
    case 'remoteMatches':
      return t('result.remoteMatches');
    case 'packCreated':
      return [
        t('result.packCreated'),
        t('result.packSigned', { sequence: result.sequence }),
        ...(result.keyCreated ? [t('result.packKeyCreated')] : []),
        t('result.packUploadHelp'),
      ].join(' ');
    case 'packsAdded': {
      const parts = [t('result.packsAdded', { count: result.added })];
      if (result.skippedCount > 0) {
        const listed = result.skipped
          .map((s) => `${s.name} (${t(`result.packSkip.${s.reason}`)})`)
          .join(', ');
        const more = result.skippedCount - result.skipped.length;
        parts.push(
          t('result.packsSkipped', { count: result.skippedCount }),
          more > 0 ? `${listed} ${t('result.packsMore', { count: more })}` : listed,
        );
      }
      return parts.join(' ');
    }
    case 'launcherZipCreated':
      return [
        t('result.launcherZipCreated'),
        ...(result.keyCreated ? [t('result.launcherZipKeyCreated')] : []),
      ].join(' ');
  }
}
