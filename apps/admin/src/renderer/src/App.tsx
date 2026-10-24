import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelClose, finishClose, onCloseRequest, runConfirmedSwitch } from './adapters/discard';
import { deriveInsights } from './adapters/insights';
import { AboutDialog } from './components/AboutDialog';
import { LoginCodeDialog } from './components/LoginCodeDialog';
import { MenuBar } from './components/MenuBar';
import { Sidebar } from './components/Sidebar';
import { Splash } from './components/Splash';
import { UnsavedDialog } from './components/UnsavedDialog';
import { useApplicationInfo } from './hooks/useApplicationInfo';
import { useStudio } from './hooks/useStudio';
import { useStudioLocale } from './i18n';
import { buildMenus, shortcutAction } from './menus';
import { PageContent, type PageId } from './pages/Pages';
import { useSettingsState } from './settings/state';
import { appReady } from './splash';

export function App() {
  const { t, preference, setLocale, useAutomaticLocale: followSystem } = useStudioLocale();
  const rawStudio = useStudio();
  const [aboutOpen, setAboutOpen] = useState(false);
  const studio = rawStudio;
  const insights = deriveInsights(studio.state);
  const settings = useSettingsState();
  const { info, error } = useApplicationInfo();
  const [page, setPageState] = useState<PageId>('overview');
  const [splashDone, setSplashDone] = useState(false);
  const [confirm, setConfirm] = useState<'new' | 'open' | 'close' | 'project' | null>(null);
  useEffect(() => onCloseRequest(() => setConfirm('close')), []);
  const finishSplash = useCallback(() => setSplashDone(true), []);
  const { draft, state, busy, message, clearMessage } = studio;
  /** A command's message belongs to the page it ran on; it is dropped when navigating away. */
  const setPage = useCallback(
    (next: PageId) => {
      clearMessage();
      setPageState(next);
    },
    [clearMessage],
  );

  // The OS window frame is native; its title carries the project name.
  useEffect(() => {
    document.title = draft
      ? `${draft.name || 'TorchLauncher'} · TorchLauncher Studio`
      : 'TorchLauncher Studio';
  }, [draft]);

  const switchTo = (action: 'new' | 'open') => runConfirmedSwitch(rawStudio, action);
  /** Unsaved changes are confirmed in the app before a project is replaced or closed. */
  const switchProject = (action: 'new' | 'open') => {
    if (state?.dirty) setConfirm(action);
    else void switchTo(action);
  };
  const closeProject = async (discard: boolean) => {
    setPageState('overview');
    await rawStudio.run('closeProject', discard ? { discard: true } : {});
  };
  const confirmSave = async () => {
    const action = confirm;
    if (!action) return;
    if (!(await rawStudio.run('save'))) {
      // A cancelled or failed save keeps a close request open so nothing is lost silently.
      if (action !== 'close') setConfirm(null);
      return;
    }
    setConfirm(null);
    if (action === 'close') await finishClose(rawStudio);
    else if (action === 'project') await closeProject(false);
    else await switchTo(action);
  };
  const confirmDiscard = () => {
    const action = confirm;
    setConfirm(null);
    if (action === 'close') void finishClose(rawStudio);
    else if (action === 'project') void closeProject(true);
    else if (action) void switchTo(action);
  };
  const confirmCancel = () => {
    if (confirm === 'close') void cancelClose(rawStudio);
    setConfirm(null);
  };

  const hasProject = !!draft;
  const actions = {
    newProject: () => switchProject('new'),
    openProject: () => switchProject('open'),
    save: () => void studio.run('save'),
    saveAs: () => void studio.run('saveAs'),
    closeProject: () => (state?.dirty ? setConfirm('project') : void closeProject(false)),
    // Main closes the window through its normal close handler, so the unsaved flow applies
    // (a renderer-side window.close() skips that handler).
    exit: () => void window.torchlauncher.request({ action: 'exit' }),
    language: (choice: Parameters<typeof setLocale>[0] | 'auto') =>
      choice === 'auto' ? followSystem() : setLocale(choice),
    about: () => setAboutOpen(true),
  };
  const menus = buildMenus({ t, hasProject, busy, preference, actions });
  // One shortcut listener: ignored while busy or a modal is open; text inputs keep working.
  const shortcutRef = useRef<(event: KeyboardEvent) => void>(() => {});
  shortcutRef.current = (event) => {
    const action = shortcutAction(event);
    if (!action || busy || !splashDone) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    if ((action === 'save' || action === 'saveAs' || action === 'closeProject') && !hasProject)
      return;
    event.preventDefault();
    actions[action]();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcutRef.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const infoText = error
    ? t('shell.infoFailed')
    : info
      ? `v${info.version} · ${info.platform}`
      : t('shell.infoLoading');

  return (
    <>
      <div className="frame" inert={!splashDone}>
        <MenuBar label={t('menu.bar')} menus={menus} />
        <div className="app-shell" data-testid="app-shell">
          {draft && (
            <Sidebar studio={studio} insights={insights} page={page} onNavigate={setPage} />
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
                      {studio.canCancel && state?.testRun.phase !== 'running' && (
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
      </div>
      {aboutOpen && (
        <AboutDialog
          version={info?.version ?? null}
          platform={info?.platform ?? null}
          onClose={() => setAboutOpen(false)}
        />
      )}
      {state?.account.login && (
        <LoginCodeDialog
          code={state.account.login.code}
          onCopy={() => studio.testCommand({ action: 'testLoginCopyCode' })}
          onCancel={() => void studio.run('cancel')}
        />
      )}
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
