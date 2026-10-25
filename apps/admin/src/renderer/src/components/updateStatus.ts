import type { UpdateState } from '../../../shared/updates';

import { formatBytes } from '../format';
import type { useStudioLocale } from '../i18n';

type Translate = ReturnType<typeof useStudioLocale>['t'];

/** Shared status wording for the open menu and the toast shown after explicit actions. */
export function updateStatus(t: Translate, state: UpdateState): string {
  switch (state.phase) {
    case 'available':
      return t('help.available', { version: state.version });
    case 'downloaded':
      return t('help.downloaded', { version: state.version });
    case 'downloading':
      return t('help.downloading', {
        size: formatBytes(state.received),
      });
    case 'error':
      if (state.code === 'LAUNCHER_NO_RELEASE') return t('help.noRelease');
      if (state.code === 'LAUNCHER_OFFLINE') return t('help.offline');
      if (
        state.code === 'LAUNCHER_VERIFY' ||
        state.code === 'INVALID' ||
        state.code === 'TOO_LARGE'
      )
        return t('help.verifyFailed');
      if (state.code === 'UNSUPPORTED_TARGET') return t('help.unsupported');
      return t('help.failed');
    case 'idle':
      return t('help.idle');
    case 'checking':
      return t('help.checking');
    case 'current':
      return t('help.current');
    case 'cancelled':
      return t('help.cancelled');
  }
}
