import type {
  SettingPolicyChoice,
  StudioConfigItem,
  StudioGameOption,
  StudioPolicyStatus,
  StudioRequest,
} from '../../../../shared/studio.js';
import { FolderIcon, GamepadIcon, PlusIcon } from '../../components/Icons';
import { Modal } from '../../components/Modal';
import { Chip, Note, type Policy3, PolicyControl } from '../../components/ui';
import { formatBytes } from '../../format';
import { useStudioLocale } from '../../i18n';

export type Send = (request: StudioRequest) => void;
export type Labels = Record<Policy3, string>;

export const isKeybind = (option: StudioGameOption) =>
  option.kind === 'keybind' || option.kind === 'mod-keybind' || option.key.startsWith('key_');

/** Translated names of the three-state policy control. */
export function usePolicyLabels(): Labels {
  const { t } = useStudioLocale();
  return {
    none: t('settings.policy.none'),
    initial: t('settings.policy.initial'),
    required: t('settings.policy.required'),
  };
}

/** Policy size usage bar and the current policy error of the project, if any. */
export function PolicyUsage({ policy }: { policy: StudioPolicyStatus | null }) {
  const { t } = useStudioLocale();
  if (!policy) return null;
  return (
    <>
      <div className="usage" data-testid="settings-policy">
        <Chip tone={policy.error ? 'warn' : undefined}>
          {t('settings.usage', {
            bytes: formatBytes(policy.bytes),
            limit: formatBytes(policy.limit),
          })}
        </Chip>
        <span className="meter" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (policy.bytes / policy.limit) * 100)}%` }} />
        </span>
      </div>
      {policy.error && (
        <Note tone="warn" testId="settings-policy-error">
          <b>{t('settings.usage.error')}</b> {policy.error.message}
        </Note>
      )}
    </>
  );
}

export function ItemRows({
  items,
  labels,
  busy,
  onChange,
}: {
  items: StudioConfigItem[];
  labels: Labels;
  busy: boolean;
  onChange(key: string, policy: SettingPolicyChoice): void;
}) {
  const { t } = useStudioLocale();
  return (
    <>
      {items.map((item) => (
        <div className="kr" key={item.key}>
          <span className="n">
            <strong>{item.key}</strong>
          </span>
          <span className="key">{item.value}</span>
          <PolicyControl
            value={item.policy}
            disabled={busy}
            onChange={(value) => onChange(item.key, value)}
            labels={labels}
            groupLabel={t('settings.policyOf', { name: item.key })}
          />
        </div>
      ))}
    </>
  );
}

export function PackHeader({
  title,
  sub,
  add,
  busy,
  disabled,
  onAdd,
}: {
  title: string;
  sub: string;
  add: string;
  busy: boolean;
  disabled: boolean;
  onAdd(): void;
}) {
  return (
    <div className="sechead">
      <div>
        <h2>{title}</h2>
        <p className="sub tight">{sub}</p>
      </div>
      <button
        type="button"
        className="btn sm"
        disabled={busy || disabled}
        data-testid="pack-add"
        onClick={onAdd}
      >
        <PlusIcon />
        {add}
      </button>
    </div>
  );
}

const packColors = ['#2f6b4f', '#4a4f8f', '#8f5a2f', '#7a4fa3', '#2f6b8f', '#8f4a4a'];
export const packColor = (name: string) =>
  packColors[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % packColors.length];

export function PresetDialog({
  busy,
  onCancel,
  onImport,
}: {
  busy: boolean;
  onCancel(): void;
  onImport(source: 'folder' | 'file'): void;
}) {
  const { t } = useStudioLocale();
  return (
    <Modal titleId="preset-title" testId="preset-dialog" className="wide" onCancel={onCancel}>
      <h2 id="preset-title">{t('settings.dialog.title')}</h2>
      <p className="lead">
        {t('settings.dialog.lead1')} <b>{t('settings.dialog.lead2')}</b>{' '}
        {t('settings.dialog.lead3')}
      </p>
      <button
        type="button"
        className="big p dlgbtn"
        disabled={busy}
        data-autofocus
        data-testid="import-folder"
        onClick={() => onImport('folder')}
      >
        <span className="ic">
          <FolderIcon />
        </span>
        <span>
          <strong>{t('settings.dialog.folder')}</strong>
          <small>{t('settings.dialog.folderHelp')}</small>
        </span>
      </button>
      <div className="or">{t('settings.dialog.or')}</div>
      <button
        type="button"
        className="big dlgbtn"
        disabled={busy}
        data-testid="import-file"
        onClick={() => onImport('file')}
      >
        <span className="ic">
          <GamepadIcon />
        </span>
        <span>
          <strong>{t('settings.dialog.file')}</strong>
          <small>{t('settings.dialog.fileHelp')}</small>
        </span>
      </button>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </Modal>
  );
}
