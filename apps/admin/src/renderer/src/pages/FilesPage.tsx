import { useState } from 'react';
import type { FilePolicyChoice, StudioFileEntry } from '../../../shared/studio.js';
import { ArrowIcon, FolderIcon, PlusIcon, RefreshIcon } from '../components/Icons';
import { Checkbox, Chip, Note, PageHeader } from '../components/ui';
import { formatBytes } from '../format';
import { useStudioLocale } from '../i18n';
import type { PageProps } from './types';

export function FilesPage({ studio, insights, go }: PageProps) {
  const { t } = useStudioLocale();
  const { busy, state, run, command } = studio;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const sourceReady = !!state?.sourceName;
  const files = insights.files;
  const entries = files?.entries ?? [];
  const live = new Set(entries.map((entry) => entry.path));
  const chosen = [...selected].filter((path) => live.has(path));
  const selectable = entries.filter((entry) => entry.policy !== 'managed');
  const hasBuild = insights.deploy.lastBuild !== null;

  const apply = async (paths: string[], policy: FilePolicyChoice) => {
    if (paths.length === 0) return;
    await command({ action: 'filesPolicy', paths, policy });
    setSelected(new Set());
  };
  const toggle = (path: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(path);
    else next.delete(path);
    setSelected(next);
  };
  const allOn = selectable.length > 0 && selectable.every((entry) => selected.has(entry.path));
  const changeChip = (entry: StudioFileEntry) => {
    if (!entry.change || entry.change === 'unchanged') return null;
    const label = {
      added: t('files.chg.added'),
      modified: t('files.chg.modified'),
      removed: t('files.chg.removed'),
    }[entry.change];
    return <span className={`chg ${entry.change === 'added' ? 'add' : 'mod'}`}>{label}</span>;
  };

  return (
    <>
      <PageHeader
        eyebrow={t('files.eyebrow')}
        title={t('files.title')}
        lead={t('files.lead')}
        actions={
          <button type="button" className="btn primary" onClick={() => go('deploy')}>
            {t('files.rebuild')}
            <ArrowIcon />
          </button>
        }
      />
      <section className="card slim">
        <div className="srcrow">
          <FolderIcon />
          <div className="srcname">
            <div className="fine">{t('files.source')}</div>
            <div className="mono" data-testid="source-name">
              {state?.sourceName ?? t('files.sourceNone')}
            </div>
          </div>
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            onClick={() => void run('source')}
          >
            {t('files.sourceChange')}
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={busy || !sourceReady}
            onClick={() => void run('files')}
          >
            <PlusIcon />
            {t('files.add')}
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={busy || !sourceReady}
            data-testid="files-rescan"
            onClick={() => void command({ action: 'rescan' })}
          >
            <RefreshIcon />
            {t('files.rescan')}
          </button>
        </div>
        {!sourceReady && (
          <p className="err pad" role="status">
            {t('files.needSource')}
          </p>
        )}
      </section>
      <div className="legend">
        <div className="lg">
          <b>{t('files.policy.always')}</b>
          {t('files.legend.always')}
        </div>
        <div className="lg">
          <b>{t('files.policy.initial')}</b>
          {t('files.legend.initial')}
        </div>
      </div>
      <section className="card tablecard">
        <div className="chips">
          <Chip>
            {t('files.totalSize', {
              count: files?.counts.total ?? 0,
              size: formatBytes(files?.counts.totalBytes ?? 0),
            })}
          </Chip>
          {hasBuild && (
            <Chip tone={insights.changed > 0 ? 'warn' : undefined}>
              {t('files.changed', { count: insights.changed })}
            </Chip>
          )}
          {(files?.counts.excluded ?? 0) > 0 && (
            <Chip>{t('files.excluded', { count: files?.counts.excluded ?? 0 })}</Chip>
          )}
          {(files?.counts.missing ?? 0) > 0 && (
            <Chip tone="warn">{t('files.missing', { count: files?.counts.missing ?? 0 })}</Chip>
          )}
        </div>
        {chosen.length > 0 && (
          <div className="bulk" data-testid="files-bulk">
            <span>
              <b>{t('files.selected', { count: chosen.length })}</b> · {t('files.bulk')}
            </span>
            <span className="pol">
              <button type="button" disabled={busy} onClick={() => void apply(chosen, 'always')}>
                {t('files.policy.always')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void apply(chosen, 'initial-only')}
              >
                {t('files.policy.initial')}
              </button>
              <button type="button" disabled={busy} onClick={() => void apply(chosen, 'excluded')}>
                {t('files.policy.exclude')}
              </button>
            </span>
            <button type="button" className="btn sm ghost" onClick={() => setSelected(new Set())}>
              {t('files.clear')}
            </button>
          </div>
        )}
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th className="c-box">
                  <Checkbox
                    checked={allOn}
                    disabled={selectable.length === 0}
                    label={t('files.selectAll')}
                    onChange={(on) =>
                      setSelected(on ? new Set(selectable.map((entry) => entry.path)) : new Set())
                    }
                  />
                </th>
                <th>{t('files.col.path')}</th>
                <th className="c-size">{t('files.col.size')}</th>
                <th className="c-chg">{t('files.col.change')}</th>
                <th className="c-pol">{t('files.col.policy')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.path} className={entry.policy === 'excluded' ? 'off' : undefined}>
                  <td className="c-box">
                    <Checkbox
                      checked={selected.has(entry.path)}
                      disabled={entry.policy === 'managed'}
                      label={t('files.selectFile', { path: entry.path })}
                      onChange={(on) => toggle(entry.path, on)}
                    />
                  </td>
                  <td className="mono path">
                    {entry.path}
                    {entry.missing && <small className="err block">{t('files.missingRow')}</small>}
                  </td>
                  <td className="c-size dim">
                    {entry.size === null ? '—' : formatBytes(entry.size)}
                  </td>
                  <td className="c-chg">{changeChip(entry)}</td>
                  <td className="c-pol">
                    {entry.policy === 'managed' ? (
                      <button
                        type="button"
                        className="chip link"
                        onClick={() =>
                          go(
                            entry.path.toLowerCase().startsWith('resourcepacks/')
                              ? 'packs'
                              : entry.path.toLowerCase().startsWith('shaderpacks/')
                                ? 'shaders'
                                : 'playerSettings',
                          )
                        }
                      >
                        {t('files.managed')}
                      </button>
                    ) : (
                      <span
                        className="pol"
                        // biome-ignore lint/a11y/useSemanticElements: segmented control of toggle buttons
                        role="radiogroup"
                        aria-label={t('files.policyOf', { path: entry.path })}
                      >
                        {(['always', 'initial-only'] as const).map((policy) => (
                          // biome-ignore lint/a11y/useSemanticElements: segmented control of toggle buttons
                          <button
                            key={policy}
                            type="button"
                            role="radio"
                            aria-checked={entry.policy === policy}
                            className={
                              entry.policy === policy
                                ? policy === 'always'
                                  ? 'a'
                                  : 'i'
                                : undefined
                            }
                            disabled={busy}
                            onClick={() => void apply([entry.path], policy)}
                          >
                            {policy === 'always'
                              ? t('files.policy.alwaysShort')
                              : t('files.policy.initialShort')}
                          </button>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length === 0 && (
          <p className="empty-row">{sourceReady ? t('files.empty') : t('files.needSource')}</p>
        )}
        {files?.truncated && <p className="err pad">{t('files.truncated')}</p>}
        {(files?.skipped ?? 0) > 0 && (
          <p className="fine pad">{t('files.skipped', { count: files?.skipped ?? 0 })}</p>
        )}
      </section>
      <Note>
        <b>{t('files.managedNote.title')}</b> {t('files.managedNote.body')}{' '}
        <button type="button" className="textlink" onClick={() => go('playerSettings')}>
          {t('nav.playerSettings')}
        </button>
        {' · '}
        <button type="button" className="textlink" onClick={() => go('packs')}>
          {t('nav.packs')}
        </button>
        {' · '}
        <button type="button" className="textlink" onClick={() => go('shaders')}>
          {t('nav.shaders')}
        </button>
      </Note>
    </>
  );
}
