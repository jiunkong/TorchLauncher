import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelClose, finishClose, onCloseRequest, runConfirmedSwitch } from './adapters/discard';
import { deriveInsights } from './adapters/insights';
import torchUrl from './assets/torch.png';
import { AboutDialog } from './components/AboutDialog';
import { LoginCodeDialog } from './components/LoginCodeDialog';
import { MenuBar } from './components/MenuBar';
import { ProjectNameDialog } from './components/ProjectNameDialog';
import { Sidebar } from './components/Sidebar';
import { Splash } from './components/Splash';
import { UnsavedDialog } from './components/UnsavedDialog';
import { updateStatus } from './components/updateStatus';
import { useApplicationInfo } from './hooks/useApplicationInfo';
import { useStudio } from './hooks/useStudio';
import { useUpdates } from './hooks/useUpdates';
import { useStudioLocale } from './i18n';
import { buildMenus, shortcutAction } from './menus';
import { PageContent, type PageId } from './pages/Pages';
import { useSettingsState } from './settings/state';
import { appReady } from './splash';

export function App() {
  const { t, preference, setLocale, useAutomaticLocale: followSystem } = useStudioLocale();
  const rawStudio = useStudio();
  const updates = useUpdates();
  const [updateNotice, setUpdateNotice] = useState('');
  const updateRequested = useRef(false);
  const updateAction = (action: 'check' | 'download') => {
    updateRequested.current = true;
    setUpdateNotice('');
    void updates.command({ action });
  };
  useEffect(() => {
    const next = updates.state;
    if (
      !updateRequested.current ||
      updates.pending ||
      !next ||
      ['idle', 'checking', 'downloading'].includes(next.phase)
    )
      return;
    setUpdateNotice(updateStatus(t, next));
    updateRequested.current = false;
  }, [updates.state, updates.pending, t]);
  const [aboutOpen, setAboutOpen] = useState(false);
  const studio = rawStudio;
  const insights = deriveInsights(studio.state);
  const settings = useSettingsState();
  const { info, error } = useApplicationInfo();
  const [page, setPageState] = useState<PageId>('overview');
  const [splashDone, setSplashDone] = useState(false);
  const [confirm, setConfirm] = useState<'new' | 'open' | 'close' | 'project' | null>(null);
  /** The in-app name prompt shown before the native parent-folder picker (New project / Save as). */
  const [naming, setNaming] = useState<'new' | 'saveAs' | null>(null);
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

  const windowTitle = draft
    ? `${draft.name || 'TorchLauncher'} · TorchLauncher Studio`
    : 'TorchLauncher Studio';
  useEffect(() => {
    document.title = windowTitle;
  }, [windowTitle]);

  const askName = (mode: 'new' | 'saveAs') => {
    clearMessage();
    setNaming(mode);
  };
  const switchTo = (action: 'new' | 'open') => {
    if (action === 'new') {
      askName('new');
      return Promise.resolve(true);
    }
    return runConfirmedSwitch(rawStudio, action);
  };
  const submitName = async (name: string) => {
    const mode = naming;
    if (!mode) return;
    // A cancelled picker or a failed create keeps the prompt open so the name can be fixed.
    const ok =
      mode === 'new'
        ? await runConfirmedSwitch(rawStudio, 'new', name)
        : await rawStudio.run('saveAs', { name });
    if (ok) setNaming(null);
  };
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
    saveAs: () => askName('saveAs'),
    revealProject: () => void studio.command({ action: 'revealProject' }),
    closeProject: () => (state?.dirty ? setConfirm('project') : void closeProject(false)),
    // Main closes the window through its normal close handler, so the unsaved flow applies
    // (a renderer-side window.close() skips that handler).
    exit: () => void window.torchlauncher.request({ action: 'exit' }),
    language: (choice: Parameters<typeof setLocale>[0] | 'auto') =>
      choice === 'auto' ? followSystem() : setLocale(choice),
    about: () => setAboutOpen(true),
    checkUpdates: () => updateAction('check'),
    downloadUpdate: () => updateAction('download'),
  };
  const menus = buildMenus({
    t,
    hasProject,
    busy,
    preference,
    actions,
    version: info?.version,
    updates,
  });
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
        <header className="desktop-titlebar" data-testid="desktop-titlebar">
          <div className="desktop-titlebar-content">
            <img src={torchUrl} alt="" width={18} height={18} draggable={false} />
            <span title={windowTitle}>{windowTitle}</span>
          </div>
        </header>
        <MenuBar label={t('menu.bar')} menus={menus} />
        <div className="app-shell" data-testid="app-shell">
          {draft && (
            <Sidebar studio={studio} insights={insights} page={page} onNavigate={setPage} />
          )}
          <div className="col">
            <main className="page" data-testid="page" data-page={draft ? page : 'start'}>
              {updateNotice && (
                <p className="note" role="status" data-testid="update-notice">
                  {updateNotice}
                </p>
              )}
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
                onNew={() => switchProject('new')}
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
      {naming && (
        <ProjectNameDialog
          mode={naming}
          initialName={
            naming === 'saveAs'
              ? (state?.projectName ?? draft?.name ?? '')
              : t('projectName.defaultName')
          }
          busy={busy}
          failure={busy ? '' : message}
          onSubmit={(name) => void submitName(name)}
          onCancel={() => setNaming(null)}
        />
      )}
      {!splashDone && (
        <Splash ready={appReady(studio.loaded, studio.loadFailed)} onDone={finishSplash} />
      )}
    </>
  );
}
