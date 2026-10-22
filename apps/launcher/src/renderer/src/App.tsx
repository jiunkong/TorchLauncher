import { useCallback, useEffect, useRef, useState } from 'react';
import torchUrl from './assets/torch.png';
import { LegacyPage } from './components/LegacyPage';
import { Menu, type PageId } from './components/Menu';
import { Splash } from './components/Splash';
import { StopDialog } from './components/StopDialog';
import { homePrimaryCommand } from './flow';
import { runningElapsed } from './home';
import { useApplicationInfo } from './hooks/useApplicationInfo';
import { useElapsed } from './hooks/useElapsed';
import { useProduct } from './hooks/useProduct';
import { useSeenSteps } from './hooks/useSeenSteps';
import { useT } from './hooks/useTranslator';
import { Home } from './pages/Home';
import { appReady } from './splash';

export function App({ splashMinimumMs }: { splashMinimumMs?: number } = {}) {
  const t = useT();
  const { info, error } = useApplicationInfo();
  const { state, error: productError, pending, command } = useProduct();
  const [page, setPage] = useState<PageId>('home');
  // Pages other than home stay mounted so edits and loaded lists survive navigation.
  const [legacyPage, setLegacyPage] = useState<Exclude<PageId, 'home'>>('troubleshooting');
  const [menuOpen, setMenuOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
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
  const seenSteps = useSeenSteps(state);
  const statusAttempted = useRef(false);

  const navigate = useCallback((next: PageId) => {
    setPage(next);
    if (next !== 'home') setLegacyPage(next);
  }, []);

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

  const logout = () => {
    if (window.confirm(t('menu.logoutConfirm'))) void command({ type: 'logout' });
  };

  return (
    <>
      <main className="app" data-testid="app-shell" inert={!splashDone || stopOpen}>
        <Menu
          open={menuOpen}
          onToggle={() => setMenuOpen((open) => !open)}
          page={page}
          onNavigate={navigate}
          serverName={state?.server?.name ?? null}
          accountName={state?.account?.name ?? null}
          logoutDisabled={busy}
          onLogout={logout}
        />
        <div className="content">
          {page === 'home' &&
            (state ? (
              <Home
                state={state}
                productError={productError}
                pending={pending}
                elapsedMs={elapsed}
                seenSteps={seenSteps}
                applicationVersion={info?.version ?? null}
                applicationInfoFailed={error}
                onPrimary={() => {
                  const primary = homePrimaryCommand(state);
                  if (primary) void command(primary);
                }}
                onCancel={() => void command({ type: 'cancel' })}
                onStop={() => setStopOpen(true)}
                onViewLogs={() => navigate('troubleshooting')}
              />
            ) : (
              <section className="stage-home" aria-label={t('home.region')}>
                <div className="scene fallback" aria-hidden="true">
                  <img src={torchUrl} alt="" />
                </div>
                <div className="shade" />
                <div className="copy">
                  <p role={productError ? 'alert' : 'status'}>
                    {productError ? t('shell.productFailed') : t('shell.connecting')}
                  </p>
                </div>
              </section>
            ))}
          <LegacyPage
            page={legacyPage}
            state={state}
            productError={productError}
            pending={pending}
            command={command}
            hidden={page === 'home'}
            onNavigate={navigate}
            onStop={() => setStopOpen(true)}
          />
        </div>
      </main>
      {stopOpen && (
        <StopDialog
          onCancel={() => setStopOpen(false)}
          onConfirm={() => {
            setStopOpen(false);
            void command({ type: 'stop' });
          }}
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
