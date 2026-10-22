import { type ReactNode, useEffect, useRef } from 'react';
import torchUrl from '../assets/torch.png';
import { useT } from '../hooks/useTranslator';
import {
  CollapseIcon,
  LogoutIcon,
  LogsIcon,
  MenuIcon,
  ModsIcon,
  PlayIcon,
  SettingsIcon,
} from './Icons';

export type PageId = 'home' | 'mods' | 'settings' | 'troubleshooting';
const items: {
  id: PageId;
  key: 'menu.play' | 'menu.mods' | 'menu.settings' | 'menu.logs';
  icon: ReactNode;
}[] = [
  { id: 'home', key: 'menu.play', icon: <PlayIcon /> },
  { id: 'mods', key: 'menu.mods', icon: <ModsIcon /> },
  { id: 'settings', key: 'menu.settings', icon: <SettingsIcon /> },
  { id: 'troubleshooting', key: 'menu.logs', icon: <LogsIcon /> },
];

export interface MenuProps {
  open: boolean;
  onToggle(): void;
  page: PageId;
  onNavigate(page: PageId): void;
  serverName: string | null;
  accountName: string | null;
  logoutDisabled: boolean;
  onLogout(): void;
}

function Avatar({ name, label }: { name: string | null; label: string }) {
  return (
    <span className={`avatar${name ? '' : ' empty'}`} role="img" aria-label={label} title={label}>
      {name ? ([...name][0] ?? '?').toUpperCase() : '?'}
    </span>
  );
}

export function Menu(props: MenuProps) {
  const t = useT();
  const { open, page, accountName } = props;
  const toggle = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);
  // Keyboard users keep their place: the toggle is a different element in each state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` swaps the toggle element, so refocus on change.
  useEffect(() => {
    if (toggled.current) toggle.current?.focus();
  }, [open]);
  const onToggle = () => {
    toggled.current = true;
    props.onToggle();
  };
  const accountLabel = accountName ?? t('menu.loginRequired');

  if (!open)
    return (
      <nav className="rail" aria-label={t('menu.label')} data-testid="menu" data-open="false">
        <button
          ref={toggle}
          className="ri"
          type="button"
          aria-label={t('menu.open')}
          aria-expanded="false"
          aria-controls="launcher-menu"
          onClick={onToggle}
        >
          <MenuIcon />
        </button>
        <span className="sep" aria-hidden="true" />
        <div id="launcher-menu" className="rail-items">
          {items.map((item) => (
            <button
              key={item.id}
              className={`ri${page === item.id ? ' active' : ''}`}
              type="button"
              aria-label={t(item.key)}
              aria-current={page === item.id ? 'page' : undefined}
              title={t(item.key)}
              onClick={() => props.onNavigate(item.id)}
            >
              {item.icon}
            </button>
          ))}
        </div>
        <span className="sp" />
        <Avatar name={accountName} label={accountLabel} />
      </nav>
    );

  return (
    <aside className="side-open" data-testid="menu" data-open="true">
      <div className="side-head">
        <span className="opicon" aria-hidden="true">
          <img src={torchUrl} alt="" />
        </span>
        <strong className="side-name">{props.serverName ?? t('home.noServer')}</strong>
        <button
          ref={toggle}
          className="tg"
          type="button"
          aria-label={t('menu.close')}
          aria-expanded="true"
          aria-controls="launcher-menu"
          onClick={onToggle}
        >
          <CollapseIcon />
        </button>
      </div>
      <nav id="launcher-menu" className="nav" aria-label={t('menu.label')}>
        {items.map((item) => (
          <button
            key={item.id}
            className={`item${page === item.id ? ' active' : ''}`}
            type="button"
            aria-current={page === item.id ? 'page' : undefined}
            onClick={() => props.onNavigate(item.id)}
          >
            {item.icon}
            {t(item.key)}
          </button>
        ))}
      </nav>
      <div className="account">
        <Avatar name={accountName} label={accountLabel} />
        <strong className="account-name">{accountLabel}</strong>
        {accountName && (
          <button
            className="lo"
            type="button"
            aria-label={t('menu.logout')}
            title={t('menu.logout')}
            disabled={props.logoutDisabled}
            onClick={props.onLogout}
          >
            <LogoutIcon />
          </button>
        )}
      </div>
    </aside>
  );
}
