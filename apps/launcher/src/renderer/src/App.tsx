import { useCallback, useEffect, useRef, useState } from 'react';
import torchUrl from './assets/torch.png';
import { BrandingVisual } from './components/BrandingVisual';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DeleteDialog } from './components/DeleteDialog';
import { LoginCodeDialog } from './components/LoginCodeDialog';
import { Menu, type PageId } from './components/Menu';
import { LauncherMenuBar } from './components/MenuBar';
import { RecoveryDialog } from './components/RecoveryDialog';
import { RemoveUnregisteredDialog } from './components/RemoveUnregisteredDialog';
import { Splash } from './components/Splash';
import { StopDialog } from './components/StopDialog';
import { Toast, useToast } from './components/Toast';
import { updateStatus } from './components/updateStatus';
import { homePrimaryCommand } from './flow';
import { runningElapsed } from './home';
import { useApplicationInfo } from './hooks/useApplicationInfo';
import { useBranding } from './hooks/useBranding';
import { useElapsed } from './hooks/useElapsed';
import { useProduct } from './hooks/useProduct';
import { useStage } from './hooks/useStage';
import { useT } from './hooks/useTranslator';
import { useUpdates } from './hooks/useUpdates';
import { useLauncherLocale } from './i18n';
import { Home } from './pages/Home';
import { LogsPage } from './pages/Logs';
import { ModsAddButton, ModsPage } from './pages/Mods';
import { PageFrame } from './pages/PageFrame';
import { SettingsPage } from './pages/Settings';
import { appReady } from './splash';

export function App({ splashMinimumMs }: { splashMinimumMs?: number } = {}) {
  const t = useT();
  const { toast, notify } = useToast();
  const locale = useLauncherLocale();
  const updates = useUpdates();
  const branding = useBranding();
  const { info, error } = useApplicationInfo();
  const { state, error: productError, pending, command } = useProduct();
  const [page, setPage] = useState<PageId>('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [removeFile, setRemoveFile] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  // Set when the recovery window was opened because a play attempt was blocked.
  const recoveryPlay = useRef(false);
  const recoveryShown = useRef(false);
  const [splashDone, setSplashDone] = useState(false);
  const finishSplash = useCallback(() => setSplashDone(true), []);
  const observed = useElapsed(state?.running ?? false);
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (state?.runningSince === undefined) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state?.runningSince]);
  const elapsed = state ? runningElapsed(state, observed, tick) : 0;
  const stage = useStage(state);
  const statusAttempted = useRef(false);
  const updateRequested = useRef(false);
  const runUpdate = useCallback(
    async (request: { action: 'check' | 'download' }) => {
      updateRequested.current = true;
      await updates.command(request);
    },
    [updates.command],
  );
  useEffect(() => {
    const next = updates.state;
    if (!updateRequested.current || updates.pending || !next) return;
    if (next.phase === 'current' || next.phase === 'available' || next.phase === 'downloaded') {
      notify('success', updateStatus(t, next));
      updateRequested.current = false;
    } else if (next.phase === 'error' || next.phase === 'cancelled') {
      notify('error', updateStatus(t, next));
      updateRequested.current = false;
    }
  }, [updates.state, updates.pending, notify, t]);

  const navigate = useCallback((next: PageId) => setPage(next), []);

  // One status query when the home first becomes usable; no polling.
  const busy = (state?.operation ?? null) !== null || pending;
  useEffect(() => {
    if (
      !splashDone ||
      page !== 'home' ||
      !state ||
      state.configuration !== 'ready' ||
      busy ||
      statusAttempted.current ||
      state.error ||
      state.deletion?.confirmation ||
      state.status.state !== 'unknown'
    )
      return;
    statusAttempted.current = true;
    void command({ type: 'status' });
  }, [splashDone, page, state, busy, command]);

  useEffect(() => {
    if (stopOpen && !state?.running) setStopOpen(false);
  }, [stopOpen, state?.running]);

  // The "previous run" window opens by itself once per occurrence of a confirmable recovery.
  const needsConfirmation = state?.recovery?.needed === true && state.recovery.confirmable;
  const running = state?.running ?? false;
  useEffect(() => {
    if (!needsConfirmation) {
      recoveryShown.current = false;
      setRecoveryOpen(false);
      return;
    }
    if (!recoveryShown.current && splashDone && !stopOpen && !deleteOpen && !running) {
      recoveryShown.current = true;
      recoveryPlay.current = false;
      setRecoveryOpen(true);
    }
  }, [needsConfirmation, splashDone, stopOpen, deleteOpen, running]);

  useEffect(() => {
    if (deleteOpen && !state?.deletion) setDeleteOpen(false);
  }, [deleteOpen, state?.deletion]);

  const openDelete = () => {
    void command({ type: 'preview-delete' }).then((ok) => {
      if (ok) setDeleteOpen(true);
    });
  };
  const confirmRecovery = () => {
    const play = recoveryPlay.current;
    void command({ type: 'recover', acceptUncertain: true }).then((ok) => {
      setRecoveryOpen(false);
      const primary = state ? homePrimaryCommand(state) : null;
      if (ok && play && primary?.type === 'launch') void command(primary);
    });
  };

  const ready = state?.configuration === 'ready' && !busy;
  const footer = info
    ? t('footer.version', { version: info.version, platform: info.platform })
    : '';
  const frame = {
    state,
    stage,
    productError,
    command,
    onNavigate: navigate,
    onStop: () => setStopOpen(true),
  };

  const logout = () => setLogoutOpen(true);

  return (
    <>
      <header className="desktop-titlebar" data-testid="desktop-titlebar">
        <div className="desktop-titlebar-content">
          <img src={branding.icon ?? torchUrl} alt="" width={18} height={18} draggable={false} />
          <span title={branding.appName}>{branding.appName}</span>
        </div>
      </header>
      <main
        className="app"
        data-testid="app-shell"
        inert={
          !splashDone ||
          stopOpen ||
          deleteOpen ||
          recoveryOpen ||
          logoutOpen ||
          removeFile !== null ||
          !!state?.loginCode
        }
      >
        <LauncherMenuBar
          version={info?.version ?? null}
          locale={locale}
          updates={updates}
          onUpdateAction={runUpdate}
          t={t}
        />
        <div className="app-body">
          <Menu
            open={menuOpen}
            onToggle={() => setMenuOpen((open) => !open)}
            page={page}
            onNavigate={navigate}
            serverName={state?.server?.name ?? null}
            appName={branding.appName}
            brandingIcon={branding.icon}
            accountName={state?.account?.name ?? null}
            {...(state?.account?.skin ? { accountSkin: state.account.skin } : {})}
            logoutDisabled={busy}
            onLogout={logout}
          />
          <div className="content">
            {page === 'home' &&
              (state ? (
                <Home
                  state={state}
                  brandingBackground={branding.background}
                  productError={productError}
                  pending={pending}
                  elapsedMs={elapsed}
                  stage={stage}
                  applicationVersion={info?.version ?? null}
                  applicationInfoFailed={error}
                  onPrimary={() => {
                    const primary = homePrimaryCommand(state);
                    if (primary) void command(primary);
                  }}
                  onCancel={() => void command({ type: 'cancel' })}
                  onStop={() => setStopOpen(true)}
                  onViewLogs={() => navigate('troubleshooting')}
                  onReviewRecovery={() => {
                    recoveryPlay.current = true;
                    setRecoveryOpen(true);
                  }}
                />
              ) : (
                <section className="stage-home" aria-label={t('home.region')}>
                  <BrandingVisual kind="background" value={branding.background} />
                  <div className="shade" />
                  <div className="copy">
                    <p role={productError ? 'alert' : 'status'}>
                      {productError ? t('shell.productFailed') : t('shell.connecting')}
                    </p>
                  </div>
                </section>
              ))}
            {/* Other pages stay mounted so unsaved edits and loaded lists survive navigation. */}
            <PageFrame
              {...frame}
              testId="page-mods"
              hidden={page !== 'mods'}
              title={t('menu.mods')}
              subtitle={t('mods.subtitle')}
              footer={footer}
              actions={
                <ModsAddButton
                  disabled={!ready}
                  onClick={() => void command({ type: 'add-mod' })}
                />
              }
            >
              {state && (
                <ModsPage
                  onRemoveUnregistered={setRemoveFile}
                  active={page === 'mods'}
                  state={state}
                  pending={pending}
                  command={command}
                />
              )}
            </PageFrame>
            <PageFrame
              {...frame}
              testId="page-settings"
              hidden={page !== 'settings'}
              title={t('menu.settings')}
              subtitle={t('settings.subtitle')}
              footer={footer}
              showOutcome
            >
              {state && (
                <SettingsPage
                  active={page === 'settings'}
                  state={state}
                  pending={pending}
                  command={command}
                  onDelete={openDelete}
                  notify={notify}
                />
              )}
            </PageFrame>
            <LogsPage
              frame={frame}
              hidden={page !== 'troubleshooting'}
              state={state}
              command={command}
            />
          </div>
        </div>
      </main>
      <Toast toast={toast} />
      {removeFile && (
        <RemoveUnregisteredDialog
          path={removeFile}
          disabled={
            busy ||
            !!state?.running ||
            !state?.mods.some((mod) => mod.path === removeFile && mod.source === 'unregistered')
          }
          onCancel={() => setRemoveFile(null)}
          onConfirm={() => {
            const path = removeFile;
            setRemoveFile(null);
            void command({ type: 'remove-unregistered', path });
          }}
        />
      )}
      {state?.loginCode && (
        <LoginCodeDialog
          code={state.loginCode}
          onCopy={() => command({ type: 'copy-login-code' })}
          onCancel={() => void command({ type: 'cancel' })}
        />
      )}
      {logoutOpen && (
        <ConfirmDialog
          idPrefix="logout"
          title={t('menu.logoutTitle')}
          body={t('menu.logoutConfirm')}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('menu.logout')}
          disabled={busy}
          onCancel={() => setLogoutOpen(false)}
          onConfirm={() => {
            setLogoutOpen(false);
            void command({ type: 'logout' });
          }}
        />
      )}
      {stopOpen && (
        <StopDialog
          onCancel={() => setStopOpen(false)}
          onConfirm={() => {
            setStopOpen(false);
            void command({ type: 'stop' });
          }}
        />
      )}
      {deleteOpen && state?.deletion && (
        <DeleteDialog
          deletion={state.deletion}
          usage={state.usage}
          userModCount={
            state.mods.length > 0 ? state.mods.filter((mod) => mod.source === 'user').length : null
          }
          busy={busy}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={(confirmation) => {
            void command({ type: 'delete', confirmation }).then(() => setDeleteOpen(false));
          }}
        />
      )}
      {recoveryOpen && (
        <RecoveryDialog
          busy={busy}
          onLater={() => setRecoveryOpen(false)}
          onConfirm={confirmRecovery}
        />
      )}
      {!splashDone && (
        <Splash
          ready={appReady(state, productError)}
          onDone={finishSplash}
          {...(splashMinimumMs === undefined ? {} : { minimumMs: splashMinimumMs })}
        />
      )}
    </>
  );
}
