import { useMemo, useState } from 'react';
import type { FilePolicyChoice, StudioFileEntry } from '../../../shared/studio.js';
import { FolderIcon, PlusIcon, RefreshIcon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { Checkbox, Chip, Note, PageHeader } from '../components/ui';
import { formatBytes } from '../format';
import { useStudioLocale } from '../i18n';
import type { PageProps } from './types';

export function FilesPage({ studio, insights }: PageProps) {
  const { t } = useStudioLocale();
  const { busy, state, run, command } = studio;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const hasProject = !!state?.project;
  const files = insights.files;
  const entries = useMemo(
    () =>
      (files?.entries ?? []).filter(
        (entry) => entry.policy !== 'managed' && entry.policy !== 'excluded',
      ),
    [files?.entries],
  );
  const live = new Set(entries.map((entry) => entry.path));
  const chosen = [...selected].filter((path) => live.has(path));
  const selectable = entries;
  const hasBuild = insights.deploy.lastBuild !== null;
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});
  const [removePath, setRemovePath] = useState<string | null>(null);

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
      <PageHeader eyebrow={t('files.eyebrow')} title={t('files.title')} lead={t('files.lead')} />
      <section className="card slim">
        <div className="srcrow">
          <FolderIcon />
          <div className="srcname">
            <div className="fine">{t('files.source')}</div>
            <div className="mono" data-testid="source-name">
              {state?.projectName ?? t('files.sourceNone')}
            </div>
          </div>
          <button
            type="button"
            className="btn sm"
            disabled={busy || !hasProject}
            data-testid="project-reveal"
            onClick={() => void command({ action: 'revealProject' })}
          >
            {t('files.revealProject')}
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={busy || !hasProject}
            onClick={() => void run('files')}
          >
            <PlusIcon />
            {t('files.add')}
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={busy || !hasProject}
            data-testid="files-rescan"
            onClick={() => void command({ action: 'rescan' })}
          >
            <RefreshIcon />
            {t('files.rescan')}
          </button>
        </div>
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
              count: entries.filter((entry) => !entry.missing).length,
              size: formatBytes(
                entries.reduce((sum, entry) => sum + (entry.missing ? 0 : (entry.size ?? 0)), 0),
              ),
            })}
          </Chip>
          {hasBuild && (
            <Chip tone={insights.changed > 0 ? 'warn' : undefined}>
              {t('files.changed', { count: insights.changed })}
            </Chip>
          )}
          {entries.filter((entry) => entry.missing).length > 0 && (
            <Chip tone="warn">
              {t('files.missing', { count: entries.filter((entry) => entry.missing).length })}
            </Chip>
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
                <th>{t('files.col.target')}</th>
                <th className="c-size">{t('files.col.size')}</th>
                <th className="c-chg">{t('files.col.change')}</th>
                <th className="c-pol">{t('files.col.policy')}</th>
                <th>{t('files.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.path}>
                  <td className="c-box">
                    <Checkbox
                      checked={selected.has(entry.path)}
                      disabled={entry.missing}
                      label={t('files.selectFile', { path: entry.path })}
                      onChange={(on) => toggle(entry.path, on)}
                    />
                  </td>
                  <td className="mono path">
                    {entry.path}
                    {entry.missing && <small className="err block">{t('files.missingRow')}</small>}
                  </td>
                  <td>
                    <input
                      type="text"
                      className="input file-target"
                      value={targetDrafts[entry.path] ?? entry.targetPath ?? entry.path}
                      aria-label={t('files.targetPath', { path: entry.path })}
                      disabled={busy || entry.missing}
                      onChange={(event) =>
                        setTargetDrafts((drafts) => ({
                          ...drafts,
                          [entry.path]: event.target.value,
                        }))
                      }
                      onBlur={(event) => {
                        const targetPath = event.currentTarget.value.trim();
                        const current = entry.targetPath ?? entry.path;
                        if (targetPath !== current) {
                          void command({
                            action: 'filesTarget',
                            path: entry.path,
                            targetPath,
                          }).then((saved) => {
                            if (saved) {
                              setTargetDrafts((drafts) => {
                                const next = { ...drafts };
                                delete next[entry.path];
                                return next;
                              });
                            }
                          });
                        }
                      }}
                    />
                  </td>
                  <td className="c-size dim">
                    {entry.size === null ? '—' : formatBytes(entry.size)}
                  </td>
                  <td className="c-chg">{changeChip(entry)}</td>
                  <td className="c-pol">
                    <span
                      className="pol"
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
                            entry.policy === policy ? (policy === 'always' ? 'a' : 'i') : undefined
                          }
                          disabled={busy || entry.missing}
                          onClick={() => void apply([entry.path], policy)}
                        >
                          {policy === 'always'
                            ? t('files.policy.alwaysShort')
                            : t('files.policy.initialShort')}
                        </button>
                      ))}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn sm ghost"
                      disabled={busy}
                      aria-label={t('files.remove', { path: entry.path })}
                      data-testid="files-remove"
                      onClick={() => setRemovePath(entry.path)}
                    >
                      {t('files.removeButton')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length === 0 && <p className="empty-row">{t('files.empty')}</p>}
        {files?.truncated && <p className="err pad">{t('files.truncated')}</p>}
        {(files?.skipped ?? 0) > 0 && (
          <p className="fine pad">{t('files.skipped', { count: files?.skipped ?? 0 })}</p>
        )}
      </section>
      <Note>{t('files.targetHint')}</Note>
      {removePath && (
        <Modal
          titleId="files-remove-title"
          testId="files-remove-dialog"
          onCancel={() => setRemovePath(null)}
        >
          <h2 id="files-remove-title">{t('files.remove.title')}</h2>
          <p className="lead">{t('files.remove.body', { path: removePath })}</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="btn ghost"
              data-autofocus
              onClick={() => setRemovePath(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn danger"
              data-testid="files-remove-confirm"
              disabled={busy}
              onClick={() => {
                const path = removePath;
                setRemovePath(null);
                void command({ action: 'filesRemove', path });
              }}
            >
              {t('files.remove.confirm')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
