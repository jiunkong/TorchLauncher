import { useState } from 'react';
import { PROJECT_NAME_MAX, projectNameProblem } from '../../../shared/studio.js';
import { useStudioLocale } from '../i18n';
import { Modal } from './Modal';

/**
 * In-app project name prompt for New project / Save as. The name is also the folder name, so it is
 * checked with the same rules main enforces; the parent folder is chosen afterwards in main.
 */
export function ProjectNameDialog({
  mode,
  initialName,
  busy,
  failure,
  onSubmit,
  onCancel,
}: {
  mode: 'new' | 'saveAs';
  initialName: string;
  busy: boolean;
  /** Message from the last attempt (picker cancelled, folder exists, ...), shown in the prompt. */
  failure: string;
  onSubmit(name: string): void;
  onCancel(): void;
}) {
  const { t } = useStudioLocale();
  const [value, setValue] = useState(initialName);
  const [touched, setTouched] = useState(false);
  const problem = projectNameProblem(value);
  const showError = problem !== null && (touched || problem !== 'empty');
  const submit = () => {
    setTouched(true);
    if (problem === null && !busy) onSubmit(value.trim());
  };
  return (
    <Modal titleId="project-name-title" testId="project-name-dialog" onCancel={onCancel}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 id="project-name-title">
          {t(mode === 'new' ? 'projectName.titleNew' : 'projectName.titleSaveAs')}
        </h2>
        <p>{t(mode === 'new' ? 'projectName.body' : 'projectName.bodySaveAs')}</p>
        <div className="fld">
          <label htmlFor="project-name-input">{t('projectName.label')}</label>
          <input
            id="project-name-input"
            className={`inp${showError ? ' bad' : ''}`}
            type="text"
            data-autofocus
            data-testid="project-name-input"
            value={value}
            maxLength={PROJECT_NAME_MAX + 16}
            aria-invalid={showError}
            aria-describedby="project-name-help"
            onChange={(event) => {
              setValue(event.target.value);
              setTouched(true);
            }}
          />
          <span
            id="project-name-help"
            className="err"
            role={showError || failure ? 'alert' : undefined}
            data-testid="project-name-error"
          >
            {showError && problem ? t(`projectName.${problem}`) : failure}
          </span>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="btn primary"
            data-testid="project-name-submit"
            disabled={busy || problem !== null}
          >
            {t('projectName.next')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
