import { useEffect, useRef, useState } from 'react';
import type {
  StudioCommand,
  StudioError,
  StudioProject,
  StudioRequest,
  StudioState,
} from '../../../shared/studio.js';
import { useStudioLocale } from '../i18n';

export type StudioAction = Exclude<StudioCommand['action'], 'update' | 'touch' | 'state'>;

/** The outcome of the latest user-started operation; adapters derive deploy/export status from it. */
export interface StudioRun {
  seq: number;
  action: StudioRequest['action'];
  ok: boolean;
  code: StudioError | null;
}

export function useStudio() {
  const { t } = useStudioLocale();
  const [state, setState] = useState<StudioState | null>(null);
  const [draft, setDraft] = useState<StudioProject | null>(null);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [lastRun, setLastRun] = useState<StudioRun | null>(null);
  const actionLock = useRef(false);
  const sequence = useRef(0);
  const [operation, setOperation] = useState<keyof typeof operationKeys | null>(null);
  const errorMessage = (code: StudioError) => t(`error.${code}`);
  // The locale only affects the failure text; the polling must not restart with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    let active = true;
    void window.torchlauncher
      .request({ action: 'state' })
      .then((reply) => {
        if (active && reply.ok) {
          setState(reply.state);
          setDraft(reply.state.project);
        } else if (active) setLoadFailed(true);
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
          setMessage(t('error.IO'));
        }
      });
    const timer = setInterval(() => {
      void window.torchlauncher
        .request({ action: 'state' })
        .then((reply) => {
          if (active && reply.ok) setState(reply.state);
        })
        .catch(() => {});
    }, 750);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const edit = (project: StudioProject) => {
    setDraft(project);
    setMessage('');
    setState((current) => (current ? { ...current, result: null } : current));
    void window.torchlauncher
      .request({ action: 'touch' })
      .then((reply) => {
        if (reply.ok) setState(reply.state);
      })
      .catch(() => setMessage(t('error.IO')));
  };
  /** Sends the pending draft to the main process first, then the command; keeps one at a time. */
  const execute = async (
    request: StudioRequest,
    syncDraft: boolean,
  ): Promise<boolean> => {
    if (actionLock.current) return false;
    actionLock.current = true;
    setPending(true);
    if (request.action in operationKeys) setOperation(request.action as keyof typeof operationKeys);
    setMessage('');
    let ok = false;
    let code: StudioError | null = null;
    try {
      if (draft && syncDraft) {
        const updated = await window.torchlauncher.request({ action: 'update', project: draft });
        if (!updated.ok) {
          code = updated.code;
          setMessage(errorMessage(updated.code));
          return false;
        }
        setState(updated.state);
      }
      const reply = await window.torchlauncher.request(request);
      if (reply.ok) {
        ok = true;
        setState(reply.state);
        setDraft(reply.state.project);
        setMessage(reply.state.result ?? '');
      } else {
        code = reply.code;
        setMessage(errorMessage(reply.code));
      }
    } catch {
      code = 'IO';
      setMessage(t('error.IO'));
    } finally {
      actionLock.current = false;
      setPending(false);
      setOperation(null);
      sequence.current += 1;
      if (request.action !== 'update')
        setLastRun({
          seq: sequence.current,
          action: request.action,
          ok,
          code,
        });
    }
    return ok;
  };
  const run = async (action: StudioAction, options: { discard?: boolean } = {}): Promise<boolean> => {
    if (action === 'cancel') {
      try {
        await window.torchlauncher.request({ action });
      } catch {
        setMessage(t('error.IO'));
      }
      return false;
    }
    if (action === 'new' || action === 'open')
      return execute(options.discard ? { action, discard: true } : { action }, false);
    return execute({ action }, true);
  };
  /** Every other command (branding, files, settings, export, ...) goes through the same serialized path. */
  const command = (request: StudioRequest) => execute(request, true);
  /** Answers to a window-close request; not serialized with other work and never syncs the draft. */
  const answerClose = async (action: 'closeConfirm' | 'closeCancel') => {
    try {
      await window.torchlauncher.request({ action });
    } catch {
      setMessage(t('error.IO'));
    }
  };
  const serviceBusy = state?.busy ?? null;
  const effectiveOperation = operation ?? serviceBusy;
  const operationLabel = t(operationKeys[effectiveOperation ?? 'work']);
  return {
    state,
    draft,
    edit,
    run,
    command,
    answerClose,
    message,
    lastRun,
    loaded: state !== null,
    loadFailed,
    operationLabel,
    showByteProgress:
      effectiveOperation === 'build' ||
      effectiveOperation === 'building' ||
      effectiveOperation === 'export' ||
      effectiveOperation === 'exporting',
    canCancel: pending || !!serviceBusy,
    busy: pending || !!serviceBusy,
  };
}
export type StudioController = ReturnType<typeof useStudio>;

const operationKeys = {
  new: 'op.new',
  open: 'op.open',
  save: 'op.save',
  saveAs: 'op.save',
  source: 'op.source',
  files: 'op.files',
  build: 'op.build',
  check: 'op.check',
  export: 'op.export',
  cancel: 'op.new',
  saving: 'op.save',
  opening: 'op.open',
  choosing: 'op.choosing',
  building: 'op.build',
  checking: 'op.check',
  exporting: 'op.export',
  work: 'op.work',
  rescan: 'op.rescan',
  exportCheck: 'op.check',
  settingsImport: 'op.settings',
  settingsPackAdd: 'op.settings',
} as const;
