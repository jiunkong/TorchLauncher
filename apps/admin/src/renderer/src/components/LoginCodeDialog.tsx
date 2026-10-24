import { useEffect, useState } from 'react';
import { useStudioLocale } from '../i18n';
import { Modal } from './Modal';

/**
 * Microsoft device login: the code is shown in this window (fed by `account.login`), the user types
 * it into the Microsoft page that main opened. Cancelling sends the same cancel the page uses.
 */
export function LoginCodeDialog({
  code,
  onCopy,
  onCancel,
}: {
  code: string;
  onCopy(): Promise<boolean>;
  onCancel(): void;
}) {
  const { t } = useStudioLocale();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Modal titleId="login-title" testId="login-dialog" onCancel={onCancel}>
      <h2 id="login-title">{t('login.title')}</h2>
      <p>{t('login.lead')}</p>
      <output className="code" aria-label={t('login.codeLabel')} data-testid="login-code">
        {code}
      </output>
      <div className="login-wait">
        <span className="spin" aria-hidden="true" />
        {t('login.waiting')}
      </div>
      <p className="login-copied" role="status" data-testid="login-copied">
        {copied ? t('login.copied') : ''}
      </p>
      <div className="dialog-actions between">
        <button
          type="button"
          className="btn"
          data-autofocus
          onClick={() => void onCopy().then((ok) => ok && setCopied(true))}
        >
          {t('login.copy')}
        </button>
        <button type="button" className="btn" data-testid="login-cancel" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </Modal>
  );
}
