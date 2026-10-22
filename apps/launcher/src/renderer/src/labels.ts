import type { ActivityStage } from './activity';
import type { LauncherKey } from './i18n/catalog';
import type { Translate } from './i18n/translate';

const failureKeys = {
  secure_storage_unavailable: 'failure.secure_storage_unavailable',
  no_session: 'failure.no_session',
  reauthentication_required: 'failure.reauthentication_required',
  cancelled: 'failure.cancelled',
  busy: 'failure.busy',
  locked: 'failure.locked',
  'recovery-required': 'failure.recovery-required',
  'deletion-incomplete': 'failure.deletion-incomplete',
  'required-pack-removed': 'failure.required-pack-removed',
  'required-pack-reordered': 'failure.required-pack-reordered',
  'options-owned-by-sync': 'failure.options-owned-by-sync',
  'preferences-failed': 'failure.preferences-failed',
  'sync-not-initialized': 'failure.sync-not-initialized',
  'configuration-unavailable': 'failure.configuration-unavailable',
  network_failed: 'failure.network_failed',
  timeout: 'failure.timeout',
  'unsupported-platform': 'failure.unsupported-platform',
  'unsupported-game': 'failure.unsupported-game',
  'operation-failed': 'failure.operation-failed',
  'limit-exceeded': 'failure.limit-exceeded',
  'confirmation-expired': 'failure.confirmation-expired',
  'confirmation-invalid': 'failure.confirmation-invalid',
} as const satisfies Record<string, LauncherKey>;

const operationKeys = {
  login: 'operation.login',
  refresh: 'operation.refresh',
  logout: 'operation.logout',
  status: 'operation.status',
  inspect: 'operation.inspect',
  recover: 'operation.recover',
  mods: 'operation.mods',
  'add-mod': 'operation.add-mod',
  'remove-mod': 'operation.remove-mod',
  'adopt-mod': 'operation.adopt-mod',
  packs: 'operation.packs',
  'set-packs': 'operation.set-packs',
  usage: 'operation.usage',
  'preview-delete': 'operation.preview-delete',
  delete: 'operation.delete',
} as const satisfies Record<string, LauncherKey>;

const outcomeKeys = {
  deleted: 'outcome.deleted',
  stopped: 'outcome.stopped',
  cancelled: 'outcome.cancelled',
  'process-error': 'outcome.process-error',
  'lock-error': 'outcome.lock-error',
  'not-needed': 'outcome.not-needed',
  recovered: 'outcome.recovered',
} as const satisfies Record<string, LauncherKey>;

const lookup = <Map extends Record<string, LauncherKey>>(map: Map, code: string) =>
  Object.hasOwn(map, code) ? map[code as keyof Map] : undefined;

export function failureMessage(t: Translate, code: string): string {
  const key = lookup(failureKeys, code);
  return key ? t(key) : t('failure.default');
}

export function operationLabel(t: Translate, operation: string, phase: string): string {
  if (operation === 'launch')
    return phase === 'game-running' ? t('operation.launchRunning') : t('operation.launchPreparing');
  const key = lookup(operationKeys, operation);
  return key ? t(key) : t('operation.default');
}

export function outcomeLabel(t: Translate, outcome: string): string {
  if (outcome.startsWith('exited-')) {
    const code = outcome.slice('exited-'.length);
    return code === '0' ? t('outcome.exitedOk') : t('outcome.exitedCode', { code });
  }
  const key = lookup(outcomeKeys, outcome);
  return key ? t(key) : t('outcome.default');
}

const stageKeys = {
  info: 'stage.info',
  game: 'stage.game',
  loader: 'stage.loader',
  sync: 'stage.sync',
} as const satisfies Record<ActivityStage, LauncherKey>;
const stageNowKeys = {
  info: 'stage.nowInfo',
  game: 'stage.nowGame',
  loader: 'stage.nowLoader',
  sync: 'stage.nowSync',
} as const satisfies Record<ActivityStage, LauncherKey>;

export const stageLabel = (t: Translate, stage: ActivityStage) => t(stageKeys[stage]);
export const stageNowLabel = (t: Translate, stage: ActivityStage) => t(stageNowKeys[stage]);

const issueKeys = {
  'lock-uncertain': 'recovery.issueLockUncertain',
  'install-invalid': 'recovery.issueInstallInvalid',
  'synchronization-invalid': 'recovery.issueSynchronizationInvalid',
  'user-mods-invalid': 'recovery.issueUserModsInvalid',
} as const satisfies Record<string, LauncherKey>;

/** Cause text for the recovery issue codes; unknown codes get one generic sentence. */
export function recoveryIssueText(t: Translate, issues: readonly string[]): string {
  const texts = issues.map((code) => {
    const key = lookup(issueKeys, code);
    return key ? t(key) : t('recovery.issueUnknown');
  });
  return [...new Set(texts.length > 0 ? texts : [t('recovery.issueUnknown')])].join(' ');
}
