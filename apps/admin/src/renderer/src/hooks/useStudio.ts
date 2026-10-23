import { useEffect, useRef, useState } from 'react';
import type {
  StudioCommand,
  StudioError,
  StudioProject,
  StudioState,
} from '../../../shared/studio.js';

const messages: Record<StudioError, string> = {
  INVALID:
    '입력값이나 선택한 경로를 확인하세요. 문제가 있는 필드와 작업 안내를 수정한 뒤 다시 시도할 수 있습니다.',
  BUSY: '다른 작업이 진행 중입니다.',
  CANCELLED: '작업을 취소했습니다.',
  IO: '작업에 실패했습니다. 파일 접근 권한, 선택한 경로 또는 네트워크 상태를 확인하세요.',
  MISMATCH: '배포 파일의 서버 ID, Minecraft 또는 로더가 현재 프로젝트와 다릅니다.',
  NO_PROJECT: '프로젝트를 먼저 만들거나 여세요.',
  UNTRUSTED: '요청을 허용하지 않았습니다. 앱을 다시 실행하세요.',
  ENCRYPTION_UNAVAILABLE:
    '이 환경에서는 서명 키를 안전하게 암호화해 보관할 수 없어 서명할 수 없습니다.',
  KEY_EXISTS: '이 프로젝트에는 이미 다른 서명 키가 있습니다.',
  KEY_MISSING: '이 프로젝트의 서명 키가 없습니다.',
  KEY_CORRUPT: '저장된 서명 키를 읽을 수 없습니다. 백업에서 복원하세요.',
  KEY_MISMATCH: '이 키 백업은 이 프로젝트(서버)의 것이 아닙니다.',
  WEAK_PASSPHRASE: '패스프레이즈는 12자 이상이어야 합니다.',
  BACKUP_INVALID: '서명 키 백업 파일이 올바르지 않습니다.',
  BACKUP_UNSUPPORTED: '지원하지 않는 서명 키 백업 버전입니다.',
  BACKUP_AUTH: '패스프레이즈가 틀렸거나 백업 파일이 손상되었습니다.',
  BLOCKED: '내보내기 전 확인을 통과하지 못했습니다.',
  TOO_LARGE: '선택한 파일이 허용 크기를 넘습니다.',
};
export function useStudio() {
  const [state, setState] = useState<StudioState | null>(null);
  const [draft, setDraft] = useState<StudioProject | null>(null);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const actionLock = useRef(false);
  const [operation, setOperation] = useState<Exclude<
    StudioCommand['action'],
    'update' | 'touch' | 'state' | 'cancel'
  > | null>(null);
  useEffect(() => {
    let active = true;
    void window.torchlauncher
      .request({ action: 'state' })
      .then((reply) => {
        if (active && reply.ok) {
          setState(reply.state);
          setDraft(reply.state.project);
        }
      })
      .catch(() => {
        if (active) setMessage(messages.IO);
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
      .catch(() => setMessage(messages.IO));
  };
  const run = async (action: Exclude<StudioCommand['action'], 'update' | 'touch' | 'state'>) => {
    if (action === 'cancel') {
      try {
        await window.torchlauncher.request({ action });
      } catch {
        setMessage(messages.IO);
      }
      return;
    }
    if (actionLock.current) return;
    actionLock.current = true;
    setPending(true);
    setOperation(action);
    setMessage('');
    try {
      if (draft && !['new', 'open'].includes(action)) {
        const updated = await window.torchlauncher.request({ action: 'update', project: draft });
        if (!updated.ok) {
          setMessage(messages[updated.code]);
          return;
        }
        setState(updated.state);
      }
      const reply = await window.torchlauncher.request({ action });
      if (reply.ok) {
        setState(reply.state);
        setDraft(reply.state.project);
        setMessage(reply.state.result ?? '');
      } else setMessage(messages[reply.code]);
    } catch {
      setMessage(messages.IO);
    } finally {
      actionLock.current = false;
      setPending(false);
      setOperation(null);
    }
  };
  const serviceBusy = state?.busy ?? null;
  const effectiveOperation = operation ?? serviceBusy;
  const operationLabel = (
    {
      new: '새 프로젝트를 준비하는 중…',
      open: '프로젝트를 여는 중…',
      save: '프로젝트를 저장하는 중…',
      saveAs: '프로젝트를 저장하는 중…',
      source: '소스 폴더를 선택하는 중…',
      files: '파일을 추가하는 중…',
      build: 'torchpack을 생성하는 중…',
      check: '배포 URL을 확인하는 중…',
      export: '런처 폴더를 내보내는 중…',
      saving: '프로젝트를 저장하는 중…',
      opening: '프로젝트를 여는 중…',
      choosing: '선택을 기다리는 중…',
      building: 'torchpack을 생성하는 중…',
      checking: '배포 URL을 확인하는 중…',
      exporting: '런처 폴더를 내보내는 중…',
    } as const
  )[effectiveOperation ?? 'new'];
  return {
    state,
    draft,
    edit,
    run,
    message,
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
