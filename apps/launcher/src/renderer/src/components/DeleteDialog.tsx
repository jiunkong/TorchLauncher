import type { ProductState } from '../../../shared/product';
import { formatBytes } from '../format';
import { useT } from '../hooks/useTranslator';
import { Modal } from './Modal';

/** Server-data deletion confirmation; the delete button needs a live confirmation token. */
export function DeleteDialog({
  deletion,
  usage,
  userModCount,
  busy,
  onCancel,
  onConfirm,
}: {
  deletion: NonNullable<ProductState['deletion']>;
  usage: ProductState['usage'];
  /** `null` while the mod list has not been loaded. */
  userModCount: number | null;
  busy: boolean;
  onCancel(): void;
  onConfirm(confirmation: string): void;
}) {
  const t = useT();
  const token = deletion.confirmation;
  const canDelete = deletion.deletable && token !== null && !busy;
  const bytes = deletion.bytes ?? usage?.bytes ?? null;
  const size =
    bytes === null
      ? t('delete.sizeUnknown')
      : usage
        ? t('settings.usageValue', {
            size: formatBytes(bytes),
            files: usage.files.toLocaleString(),
          })
        : formatBytes(bytes);
  return (
    <Modal
      titleId="delete-title"
      bodyId="delete-body"
      testId="delete-dialog"
      className="wide"
      onCancel={onCancel}
    >
      <h2 id="delete-title">{t('delete.title')}</h2>
      <p id="delete-body" className="lead">
        {t('delete.body')}
      </p>
      <div className="kv">
        <span>{t('delete.location')}</span>
        <span className="mono selectable path">{deletion.root}</span>
      </div>
      <div className="kv">
        <span>{t('delete.size')}</span>
        <span>{size}</span>
      </div>
      <div className="two">
        <div>
          <h3>{t('delete.removed')}</h3>
          <ul className="inc">
            <li>{t('delete.itemGame')}</li>
            <li>
              {userModCount === null
                ? t('delete.itemMods')
                : t('delete.itemModsCount', { count: userModCount })}
            </li>
            <li>{t('delete.itemPacks')}</li>
          </ul>
        </div>
        <div>
          <h3>{t('delete.kept')}</h3>
          <ul className="inc no">
            <li>{t('delete.keepOthers')}</li>
            <li>{t('delete.keepMinecraft')}</li>
            <li>{t('delete.keepLogin')}</li>
          </ul>
        </div>
      </div>
      {deletion.incomplete && <p className="hint">{t('delete.resume')}</p>}
      {!deletion.deletable && (
        <p className="hint warn" role="alert">
          {t('delete.blocked')}{' '}
          <span className="mono selectable">{deletion.blockers.join(', ')}</span>
        </p>
      )}
      <p className="hint">{t('delete.hint')}</p>
      <div className="dialog-actions">
        <button className="btn" type="button" data-autofocus onClick={onCancel}>
          {t('home.cancel')}
        </button>
        <button
          className="btn solid-danger"
          type="button"
          data-testid="delete-confirm"
          disabled={!canDelete}
          onClick={() => token && onConfirm(token)}
        >
          {t('delete.confirm')}
        </button>
      </div>
    </Modal>
  );
}
