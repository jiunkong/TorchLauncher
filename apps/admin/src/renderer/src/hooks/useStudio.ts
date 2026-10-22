import { useEffect, useState } from 'react';
import type {
  StudioCommand,
  StudioError,
  StudioProject,
  StudioState,
} from '../../../shared/studio.js';

const messages: Record<StudioError, string> = {
  INVALID:
    '입력을 확인하세요. 서버 이름·주소·버전·HTTPS URL, 파일 경로와 비어 있는 출력 폴더가 필요합니다.',
  BUSY: '다른 작업이 진행 중입니다.',
  CANCELLED: '작업을 취소했습니다.',
  IO: '작업에 실패했습니다. 파일 접근 권한과 공개 배포 링크, 네트워크 상태를 확인하세요.',
  MISMATCH: '배포 파일의 서버 ID, Minecraft 또는 로더가 현재 프로젝트와 다릅니다.',
  NO_PROJECT: '프로젝트를 먼저 만들거나 여세요.',
  UNTRUSTED: '요청을 허용하지 않았습니다. 앱을 다시 실행하세요.',
};
export function useStudio() {
  const [state, setState] = useState<StudioState | null>(null);
  const [draft, setDraft] = useState<StudioProject | null>(null);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
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
    void window.torchlauncher
      .request({ action: 'touch' })
      .then((reply) => {
        if (reply.ok) setState(reply.state);
      })
      .catch(() => setMessage(messages.IO));
  };
  const run = async (action: Exclude<StudioCommand['action'], 'update' | 'touch' | 'state'>) => {
    if (action === 'cancel') {
      await window.torchlauncher.request({ action });
      return;
    }
    setPending(true);
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
      setPending(false);
    }
  };
  return { state, draft, edit, run, message, busy: pending || !!state?.busy };
}
export type StudioController = ReturnType<typeof useStudio>;
