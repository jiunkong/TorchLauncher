import { useCallback, useEffect, useState } from 'react';
import {
  cancelClose,
  finishClose,
  onCloseRequest,
  runConfirmedSwitch,
} from './adapters/discard';
import { deriveInsights } from './adapters/insights';
import { Sidebar } from './components/Sidebar';
import { Splash } from './components/Splash';
import { UnsavedDialog } from './components/UnsavedDialog';
import { useApplicationInfo } from './hooks/useApplicationInfo';
import { useStudio } from './hooks/useStudio';
import { useStudioLocale } from './i18n';
import { PageContent, type PageId } from './pages/Pages';
import { useSettingsState } from './settings/state';
import { appReady } from './splash';

export function App() {
  const { t } = useStudioLocale();
  const studio = useStudio();
  const insights = deriveInsights(studio.state);
  const settings = useSettingsState();
  const { info, error } = useApplicationInfo();
  const [page, setPage] = useState<PageId>('overview');
  const [splashDone, setSplashDone] = useState(false);
  const [confirm, setConfirm] = useState<'new' | 'open' | 'close' | null>(null);
  useEffect(() => onCloseRequest(() => setConfirm('close')), []);
  const finishSplash = useCallback(() => setSplashDone(true), []);
  const { draft, state, busy, message } = studio;

  // The OS window frame is native; its title carries the project name.
  useEffect(() => {
    document.title = draft
      ? `${draft.name || 'TorchLauncher'} · TorchLauncher Studio`
      : 'TorchLauncher Studio';
  }, [draft]);

  /** Unsaved changes are confirmed in the app before a project is replaced. */
  const switchProject = (action: 'new' | 'open') => {
    if (state?.dirty) setConfirm(action);
    else void runConfirmedSwitch(studio, action);
  };
  const confirmSave = async () => {
    const action = confirm;
    if (!action) return;
    if (!(await studio.run('save'))) {
      // A cancelled or failed save keeps a close request open so nothing is lost silently.
      if (action !== 'close') setConfirm(null);
      return;
    }
    setConfirm(null);
    if (action === 'close') await finishClose(studio);
    else await runConfirmedSwitch(studio, action);
  };
  const confirmDiscard = () => {
    const action = confirm;
    setConfirm(null);
    if (action === 'close') void finishClose(studio);
    else if (action) void runConfirmedSwitch(studio, action);
  };
  const confirmCancel = () => {
    if (confirm === 'close') void cancelClose(studio);
    setConfirm(null);
  };

  const infoText = error
    ? t('shell.infoFailed')
    : info
      ? `v${info.version} · ${info.platform}`
      : t('shell.infoLoading');

  return (
    <>
      <div className="app-shell" data-testid="app-shell" inert={!splashDone}>
        {draft && (
          <Sidebar
            studio={studio}
            insights={insights}
            page={page}
            onNavigate={setPage}
            onProject={switchProject}
            info={infoText}
          />
        )}
        <div className="col">
          <main className="page" data-testid="page" data-page={draft ? page : 'start'}>
            {(message || busy) && (
              <div className="notices">
                {message && !busy && (
                  <p className="note" role="status" data-testid="studio-message">
                    {message}
                  </p>
                )}
                {busy && (
                  <div className="note" role="status" data-testid="studio-busy">
                    <span>
                      {studio.operationLabel}
                      {studio.showByteProgress &&
                        ` · ${t('shell.processed', { kib: Math.round((state?.progress ?? 0) / 1024).toLocaleString() })}`}
                    </span>
                    {studio.canCancel && (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => void studio.run('cancel')}
                      >
                        {t('common.cancel')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <PageContent
              page={page}
              studio={studio}
              insights={insights}
              settings={settings}
              go={setPage}
            />
            {!draft && (
              <p className="appinfo center" data-testid="application-info">
                {infoText}
              </p>
            )}
          </main>
        </div>
      </div>
      {confirm && (
        <UnsavedDialog
          busy={busy}
          onSave={() => void confirmSave()}
          onDiscard={confirmDiscard}
          onCancel={confirmCancel}
        />
      )}
      {!splashDone && (
        <Splash ready={appReady(studio.loaded, studio.loadFailed)} onDone={finishSplash} />
      )}
    </>
  );
}
