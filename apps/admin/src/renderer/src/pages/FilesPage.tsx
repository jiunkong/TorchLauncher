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
  const [removePath, setRemovePath] = useState<string | null>(null);
  const [targetPath, setTargetPath] = useState<string | null>(null);

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
  const targetEntry = entries.find((entry) => entry.path === targetPath) ?? null;

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
                  <td className="mono path" data-label={t('files.col.path')}>
                    {entry.path}
                    {entry.missing && <small className="err block">{t('files.missingRow')}</small>}
                  </td>
                  <td className="target-cell" data-label={t('files.col.target')}>
                    <span
                      className={`target-value${(entry.targetPath ?? entry.path) !== entry.path ? ' changed' : ''}`}
                      title={entry.targetPath ?? entry.path}
                    >
                      {entry.targetPath ?? entry.path}
                    </span>
                    <button
                      type="button"
                      className="btn sm ghost target-edit"
                      disabled={busy || entry.missing}
                      aria-label={t('files.targetEdit', { path: entry.path })}
                      data-testid="files-target-edit"
                      onClick={() => setTargetPath(entry.path)}
                    >
                      {t('files.edit')}
                    </button>
                  </td>
                  <td className="c-size dim" data-label={t('files.col.size')}>
                    {entry.size === null ? '—' : formatBytes(entry.size)}
                  </td>
                  <td className="c-chg" data-label={t('files.col.change')}>
                    {changeChip(entry)}
                  </td>
                  <td className="c-pol" data-label={t('files.col.policy')}>
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
                  <td className="file-actions" data-label={t('files.col.actions')}>
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
      <Note>{t('files.removeHint')}</Note>
      {targetEntry && (
        <FileTargetDialog
          path={targetEntry.path}
          currentTarget={targetEntry.targetPath ?? targetEntry.path}
          busy={busy}
          failure={studio.message}
          onCancel={() => setTargetPath(null)}
          onSubmit={async (nextTarget) => {
            if (nextTarget.trim() === (targetEntry.targetPath ?? targetEntry.path)) {
              setTargetPath(null);
              return;
            }
            const saved = await command({
              action: 'filesTarget',
              path: targetEntry.path,
              targetPath: nextTarget.trim(),
            });
            if (saved) setTargetPath(null);
          }}
        />
      )}
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

export function FileTargetDialog({
  path,
  currentTarget,
  busy,
  failure,
  onCancel,
  onSubmit,
}: {
  path: string;
  currentTarget: string;
  busy: boolean;
  failure: string;
  onCancel(): void;
  onSubmit(targetPath: string): Promise<void>;
}) {
  const { t } = useStudioLocale();
  const [value, setValue] = useState(currentTarget);
  const unchanged = value.trim() === currentTarget;
  return (
    <Modal titleId="files-target-title" testId="files-target-dialog" onCancel={onCancel}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !unchanged) void onSubmit(value);
        }}
      >
        <h2 id="files-target-title">{t('files.target.title')}</h2>
        <p className="lead mono target-source" title={path}>
          {path}
        </p>
        <div className="fld">
          <label htmlFor="files-target-input">{t('files.col.target')}</label>
          <input
            id="files-target-input"
            className="inp"
            type="text"
            data-autofocus
            data-testid="files-target-input"
            aria-label={t('files.targetPath', { path })}
            value={value}
            aria-describedby="files-target-hint files-target-error"
            onChange={(event) => setValue(event.target.value)}
          />
          <span id="files-target-hint" className="fine">
            {t('files.targetHint')}
          </span>
          <span id="files-target-error" className="err" role={failure ? 'alert' : undefined}>
            {failure}
          </span>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busy || value === path}
            data-testid="files-target-reset"
            onClick={() => setValue(path)}
          >
            {t('files.target.reset')}
          </button>
          <button
            type="submit"
            className="btn primary"
            data-testid="files-target-save"
            disabled={busy || unchanged}
          >
            {t('files.target.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
