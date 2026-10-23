import { useState } from 'react';
import { ArrowIcon, FolderIcon, PlusIcon, RefreshIcon } from '../components/Icons';
import { Checkbox, Chip, Note, PageHeader } from '../components/ui';
import { useStudioLocale } from '../i18n';
import { managedBy } from './filePaths';
import type { PageProps } from './types';

type Policy = 'always' | 'initial-only';

export function FilesPage({ studio, draft, insights, go }: PageProps) {
  const { t } = useStudioLocale();
  const { busy, state, run, edit } = studio;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const sourceReady = !!state?.sourceName;
  const files = draft.files;
  const live = new Set(files.map((file) => file.path));
  const chosen = [...selected].filter((path) => live.has(path));
  const selectable = files.filter((file) => !managedBy(file.path));
  const changedCount = insights.deploy.changes.added + insights.deploy.changes.modified;

  const setPolicy = (paths: string[], policy: Policy) =>
    edit({
      ...draft,
      files: files.map((file) => (paths.includes(file.path) ? { ...file, policy } : file)),
    });
  const exclude = (paths: string[]) => {
    edit({ ...draft, files: files.filter((file) => !paths.includes(file.path)) });
    setSelected(new Set());
  };
  const toggle = (path: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(path);
    else next.delete(path);
    setSelected(next);
  };
  const allOn = selectable.length > 0 && selectable.every((file) => selected.has(file.path));

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
          <button type="button" className="btn sm" disabled title={t('files.rescanUnavailable')}>
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
          <Chip>{t('files.total', { count: files.length })}</Chip>
          {insights.deploy.state !== 'unknown' && (
            <Chip tone={changedCount > 0 ? 'warn' : undefined}>
              {t('files.changed', { count: changedCount })}
            </Chip>
          )}
          {insights.deploy.state !== 'unknown' && insights.deploy.changes.excluded > 0 && (
            <Chip>{t('files.excluded', { count: insights.deploy.changes.excluded })}</Chip>
          )}
        </div>
        {chosen.length > 0 && (
          <div className="bulk" data-testid="files-bulk">
            <span>
              <b>{t('files.selected', { count: chosen.length })}</b> · {t('files.bulk')}
            </span>
            <span className="pol">
              <button type="button" disabled={busy} onClick={() => setPolicy(chosen, 'always')}>
                {t('files.policy.always')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPolicy(chosen, 'initial-only')}
              >
                {t('files.policy.initial')}
              </button>
              <button type="button" disabled={busy} onClick={() => exclude(chosen)}>
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
                      setSelected(on ? new Set(selectable.map((file) => file.path)) : new Set())
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
              {files.map((file) => {
                const owner = managedBy(file.path);
                const change = insights.fileChanges.get(file.path);
                return (
                  <tr key={file.path}>
                    <td className="c-box">
                      <Checkbox
                        checked={selected.has(file.path)}
                        disabled={!!owner}
                        label={t('files.selectFile', { path: file.path })}
                        onChange={(on) => toggle(file.path, on)}
                      />
                    </td>
                    <td className="mono path">{file.path}</td>
                    <td className="c-size dim">—</td>
                    <td className="c-chg">
                      {change && (
                        <span className={`chg ${change === 'added' ? 'add' : 'mod'}`}>
                          {change === 'added' ? t('files.chg.added') : t('files.chg.modified')}
                        </span>
                      )}
                    </td>
                    <td className="c-pol">
                      {owner ? (
                        <button type="button" className="chip link" onClick={() => go('settings')}>
                          {t('files.managed')}
                        </button>
                      ) : (
                        <span
                          className="pol"
                          role="radiogroup"
                          aria-label={t('files.policyOf', { path: file.path })}
                        >
                          {(['always', 'initial-only'] as const).map((policy) => (
                            // biome-ignore lint/a11y/useSemanticElements: segmented control of toggle buttons
                            <button
                              key={policy}
                              type="button"
                              role="radio"
                              aria-checked={file.policy === policy}
                              className={
                                file.policy === policy
                                  ? policy === 'always'
                                    ? 'a'
                                    : 'i'
                                  : undefined
                              }
                              disabled={busy}
                              onClick={() => setPolicy([file.path], policy)}
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
                );
              })}
            </tbody>
          </table>
        </div>
        {files.length === 0 && <p className="empty-row">{t('files.empty')}</p>}
      </section>
      <Note>
        <b>{t('files.managedNote.title')}</b> {t('files.managedNote.body')}{' '}
        <button type="button" className="textlink" onClick={() => go('settings')}>
          {t('nav.settings')}
        </button>
      </Note>
    </>
  );
}
