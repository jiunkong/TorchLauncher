import type { ReactNode } from 'react';
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
import { PlayerAvatar } from './PlayerAvatar';

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
  accountSkin?: string;
  logoutDisabled: boolean;
  onLogout(): void;
}

export function Menu(props: MenuProps) {
  const t = useT();
  const { open, page, accountName } = props;
  const accountLabel = accountName ?? t('menu.loginRequired');
  // One container for both states: only its width (and label visibility) transitions, so the
  // icons stay put. Hidden labels are `inert` and `visibility: hidden` once collapsed.
  return (
    <aside className="menu" data-testid="menu" data-open={open ? 'true' : 'false'}>
      <nav className="menu-nav" aria-label={t('menu.label')}>
        <div className="side-head">
          <span className="opicon fade" aria-hidden="true" inert={!open}>
            <img src={torchUrl} alt="" draggable={false} />
          </span>
          <strong
            className="side-name fade"
            inert={!open}
            title={props.serverName ?? t('home.noServer')}
          >
            {props.serverName ?? t('home.noServer')}
          </strong>
          <button
            className="tg"
            type="button"
            aria-label={open ? t('menu.close') : t('menu.open')}
            aria-expanded={open ? 'true' : 'false'}
            aria-controls="launcher-menu"
            onClick={props.onToggle}
          >
            <span className="tg-icon tg-menu">
              <MenuIcon />
            </span>
            <span className="tg-icon tg-collapse">
              <CollapseIcon />
            </span>
          </button>
        </div>
        <span className="sep" aria-hidden="true" />
        <div id="launcher-menu" className="nav">
          {items.map((item) => (
            <button
              key={item.id}
              className={`item${page === item.id ? ' active' : ''}`}
              type="button"
              aria-label={t(item.key)}
              aria-current={page === item.id ? 'page' : undefined}
              title={open ? undefined : t(item.key)}
              onClick={() => props.onNavigate(item.id)}
            >
              {item.icon}
              <span className="lbl fade" aria-hidden="true">
                {t(item.key)}
              </span>
            </button>
          ))}
        </div>
      </nav>
      <div className="account">
        <PlayerAvatar
          name={accountName}
          label={accountLabel}
          {...(props.accountSkin ? { skin: props.accountSkin } : {})}
        />
        <strong className="account-name fade" inert={!open}>
          {accountLabel}
        </strong>
        {accountName && (
          <button
            className="lo fade"
            type="button"
            aria-label={t('menu.logout')}
            title={t('menu.logout')}
            disabled={props.logoutDisabled}
            inert={!open}
            onClick={props.onLogout}
          >
            <LogoutIcon />
          </button>
        )}
      </div>
    </aside>
  );
}
