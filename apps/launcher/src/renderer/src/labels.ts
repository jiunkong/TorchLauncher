// Existing user-facing operation text, moved unchanged from App.tsx. L2 replaces these with dictionary keys.

export function failureMessage(code: string): string {
  const messages: Record<string, string> = {
    secure_storage_unavailable:
      '안전한 계정 저장소를 사용할 수 없습니다. Linux에서는 시스템 키체인 서비스를 확인하세요.',
    no_session: '저장된 계정이 없습니다. Microsoft 로그인을 진행하세요.',
    reauthentication_required: '계정 세션이 만료되었습니다. 다시 로그인하세요.',
    cancelled: '작업을 취소했습니다.',
    busy: '현재 작업이 끝난 뒤 다시 시도하세요.',
    'recovery-required': '중단된 작업이 있습니다. 문제 해결에서 복구 상태를 확인하세요.',
    'deletion-incomplete':
      '중단된 삭제가 있습니다. 설정에서 삭제 미리보기를 다시 열고 이어서 삭제하세요.',
    'required-pack-removed': '운영자 필수 리소스팩을 포함해서 저장하세요.',
    'required-pack-reordered': '운영자 필수 리소스팩의 순서를 유지하세요.',
    'options-owned-by-sync':
      '운영자가 options.txt 전체를 관리하고 있습니다. 운영자에게 설정 정책 구성을 요청하세요.',
    'preferences-failed':
      '런처 설정을 읽거나 저장하지 못했습니다. 설정 파일과 접근 권한을 확인하세요.',
    'sync-not-initialized': '게임 동기화가 완료된 뒤 설정을 변경하세요.',
    'configuration-unavailable':
      '서버 구성을 읽지 못했습니다. 운영자에게 이 서버용 런처를 다시 받으세요.',
    network_failed: '네트워크 요청에 실패했습니다. 연결을 확인한 뒤 필요한 작업을 다시 시도하세요.',
    timeout: '요청 시간이 초과되었습니다. 연결을 확인한 뒤 다시 시도하세요.',
    'unsupported-platform': '이 운영 체제 또는 CPU에서는 게임을 실행할 수 없습니다.',
    'unsupported-game': '이 배포의 게임 버전은 지원하지 않습니다. 운영자에게 확인하세요.',
    'operation-failed':
      '작업을 완료하지 못했습니다. 연결과 설정을 확인한 뒤 필요한 작업을 다시 시도하세요.',
    'limit-exceeded': '확인할 데이터가 너무 많습니다. 불필요한 파일을 정리한 뒤 다시 시도하세요.',
    'confirmation-expired':
      '확인 시간이 지나 삭제 미리보기가 만료되었습니다. 삭제 미리보기를 다시 여세요.',
  };
  return messages[code] ?? '작업을 완료하지 못했습니다. 문제 해결에서 상태를 확인하세요.';
}

export function operationLabel(operation: string, phase: string): string {
  const labels: Record<string, string> = {
    login: 'Microsoft 계정 로그인 중',
    refresh: '계정 세션 확인 중',
    logout: '계정 로그아웃 중',
    launch: phase === 'game-running' ? '게임 실행 중' : '게임 접속 준비 중',
    status: '서버 상태 확인 중',
    inspect: '복구 상태 확인 중',
    recover: '중단된 작업 복구 중',
    mods: '모드 목록 불러오는 중',
    'add-mod': '개인 모드 등록 중',
    packs: '리소스팩 설정 불러오는 중',
    'set-packs': '리소스팩 설정 저장 중',
    usage: '서버 데이터 용량 확인 중',
    'preview-delete': '삭제 미리보기 준비 중',
    delete: '서버 데이터 삭제 중',
  };
  return labels[operation] ?? '작업 중';
}

export function outcomeLabel(outcome: string): string {
  if (outcome.startsWith('exited-')) {
    const code = outcome.slice('exited-'.length);
    return code === '0' ? '게임을 정상 종료했습니다.' : `게임이 종료되었습니다 (코드 ${code}).`;
  }
  const labels: Record<string, string> = {
    deleted: '서버 데이터를 삭제했습니다.',
    stopped: '게임을 종료했습니다.',
    cancelled: '게임 실행을 취소했습니다.',
    'process-error': '게임 프로세스에서 오류가 발생했습니다. 진단 기록을 확인하세요.',
    'lock-error':
      '게임 데이터 잠금 상태를 확인하세요. 문제 해결에서 복구 상태를 확인할 수 있습니다.',
    'not-needed': '복구할 작업이 없습니다.',
    recovered: '복구를 마쳤습니다.',
  };
  return (
    labels[outcome] ?? '복구 상태를 확인했습니다. 자세한 내용은 문제 해결의 진단 기록을 확인하세요.'
  );
}
