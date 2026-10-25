import { useId, useState } from 'react';
import torchUrl from '../assets/torch.png';
import { GamepadIcon, ModsIcon, PlayIcon, SettingsIcon } from '../components/Icons';
import { PageHeader } from '../components/ui';
import { formatBytes, loaderLabel } from '../format';
import { useBrandingImage } from '../hooks/useBrandingImage';
import { useStudioLocale } from '../i18n';
import type { PageProps } from './types';

export function BrandPage({ studio, draft }: PageProps) {
  const { t } = useStudioLocale();
  const { busy, command } = studio;
  const branding = draft.branding ?? {};
  const name = branding.appName ?? '';
  const shown = name || draft.name;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const inputId = useId();
  const icon = useBrandingImage('icon', branding.icon?.sha256 ?? null);
  const background = useBrandingImage('background', branding.background?.sha256 ?? null);
  const images = { icon, background };
  const failureText = (role: 'icon' | 'background', title: string) => {
    const code = images[role].failure;
    if (!code) return null;
    const reason = code === 'MISMATCH' || code === 'TOO_LARGE' || code === 'INVALID' ? code : 'IO';
    return t('brand.previewFailed', { item: title, reason: t(`brand.previewFailed.${reason}`) });
  };
  const assetText = (asset: { length: number; mediaType: string } | null | undefined) =>
    asset
      ? `${asset.mediaType === 'image/png' ? 'PNG' : 'JPEG'} · ${formatBytes(asset.length)}`
      : t('brand.default');
  const row = (
    role: 'icon' | 'background',
    title: string,
    asset: { length: number; mediaType: string } | null | undefined,
    thumb: string,
  ) => {
    const custom = images[role].dataUrl;
    const failure = failureText(role, title);
    return (
      <div className="row3" data-testid={`brand-${role}`}>
        <span
          className="t"
          data-testid={`brand-${role}-thumb`}
          data-custom={custom ? 'true' : 'false'}
          style={role === 'background' ? { background: custom ? undefined : thumb } : undefined}
        >
          {role === 'icon' && (
            <img
              src={custom ?? torchUrl}
              alt=""
              width={30}
              height={30}
              className={custom ? 'custom' : undefined}
            />
          )}
          {role === 'background' && custom && <img src={custom} alt="" className="fill" />}
        </span>
        <span className="g">
          <strong>{title}</strong>
          <small>{assetText(asset)}</small>
          {failure && (
            <small className="brand-fail" role="alert">
              {failure}
            </small>
          )}
        </span>
        {asset && (
          <button
            className="btn sm ghost"
            type="button"
            disabled={busy}
            aria-label={t('brand.removeLabel', { item: title })}
            onClick={() => void command({ action: 'brandingRemove', role })}
          >
            {t('brand.remove')}
          </button>
        )}
        <button
          className="btn sm"
          type="button"
          disabled={busy}
          aria-label={t('brand.changeLabel', { item: title })}
          onClick={() => void command({ action: 'brandingSelect', role })}
        >
          {t('brand.change')}
        </button>
      </div>
    );
  };
  return (
    <>
      <PageHeader eyebrow={t('brand.eyebrow')} title={t('brand.title')} lead={t('brand.lead')} />
      <div className="lay">
        <div
          className="big"
          role="img"
          aria-label={t('brand.previewLabel')}
          data-testid="brand-preview"
        >
          <div className="tb">
            <img
              src={icon.dataUrl ?? torchUrl}
              alt=""
              width={14}
              height={14}
              data-testid="brand-preview-icon"
              data-custom={icon.dataUrl ? 'true' : 'false'}
            />
            {shown}
          </div>
          <div className="body">
            <div className="rl" aria-hidden="true">
              <i>
                <GamepadIcon />
              </i>
              <i className="on">
                <PlayIcon />
              </i>
              <i>
                <ModsIcon />
              </i>
              <i>
                <SettingsIcon />
              </i>
            </div>
            <div
              className="st"
              data-testid="brand-preview-bg"
              data-custom={background.dataUrl ? 'true' : 'false'}
              style={
                background.dataUrl
                  ? {
                      backgroundImage: `url("${background.dataUrl}")`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }
                  : undefined
              }
            >
              {!background.dataUrl && (
                <>
                  <span className="sun" />
                  <span className="h" />
                  <span className="h h2" />
                </>
              )}
              <span className="shd" />
              <div className="cp">
                <small>{t('brand.previewStatus')}</small>
                <b>{shown}</b>
                <small>
                  Minecraft {draft.game.minecraftVersion} · {loaderLabel(draft.game.loader.kind)}{' '}
                  {draft.game.loader.version}
                </small>
                <i>▶ {t('brand.previewPlay')}</i>
              </div>
            </div>
          </div>
        </div>
        <section className="card flush">
          {row('icon', t('brand.icon'), branding.icon, '')}
          <div className="row3" data-testid="brand-name">
            <span className="t aa">Aa</span>
            <span className="g">
              <strong>{t('brand.name')}</strong>
              <small>{name || t('brand.nameDefault', { name: draft.name })}</small>
            </span>
            <button
              className="btn sm"
              type="button"
              disabled={busy}
              aria-expanded={editing}
              aria-label={t('brand.changeLabel', { item: t('brand.name') })}
              onClick={() => {
                setValue(name);
                setEditing(!editing);
              }}
            >
              {t('brand.change')}
            </button>
          </div>
          {editing && (
            <form
              className="nameform"
              onSubmit={(event) => {
                event.preventDefault();
                void command({ action: 'brandingName', appName: value.trim() || null }).then(
                  (ok) => ok && setEditing(false),
                );
              }}
            >
              <label htmlFor={inputId}>{t('brand.name')}</label>
              <input
                id={inputId}
                className="inp"
                type="text"
                maxLength={100}
                value={value}
                placeholder={draft.name}
                onChange={(event) => setValue(event.target.value)}
              />
              <span className="fine">{t('brand.nameHelp')}</span>
              <div className="row-actions">
                <button className="btn sm ghost" type="button" onClick={() => setEditing(false)}>
                  {t('common.cancel')}
                </button>
                <button className="btn sm primary" type="submit" disabled={busy}>
                  {t('common.apply')}
                </button>
              </div>
            </form>
          )}
          {row(
            'background',
            t('brand.background'),
            branding.background,
            'linear-gradient(180deg,#36204f,#b04a3c)',
          )}
        </section>
      </div>
      <p className="fine">{t('brand.limits')}</p>
    </>
  );
}
