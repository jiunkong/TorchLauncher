import { createElement } from 'react';
import type { ProductActivity } from '../../shared/product';

const components: Record<ProductActivity['component'], string> = {
  metadata: '게임 정보',
  game: '게임 파일',
  java: 'Java',
  library: '라이브러리',
  asset: '게임 리소스',
  logging: '로그 설정',
  loader: '모드 로더',
  'server-mod': '서버 모드',
  'resource-pack': '리소스팩',
  'server-config': '서버 설정',
  'server-file': '서버 파일',
};

const phases: Record<ProductActivity['phase'], string> = {
  planning: '준비 중',
  checking: '확인 중',
  downloading: '다운로드 중',
  staging: '파일 준비 중',
  publishing: '파일 적용 중',
  installing: '설치 중',
  applying: '적용 중',
  recovering: '복구 중',
};

export function activityLabel(activity: ProductActivity): string {
  const fileComponents: ProductActivity['component'][] = [
    'server-mod',
    'resource-pack',
    'server-config',
    'server-file',
  ];
  const phase =
    fileComponents.includes(activity.component) && activity.phase === 'staging'
      ? '다운로드·검증 중'
      : phases[activity.phase];
  return `${components[activity.component]} ${phase}`;
}

export function activityProgress(activity: ProductActivity): string {
  const count = activity.completed === null ? '진행 중' : `완료 ${activity.completed}개`;
  const active = activity.active > 1 ? ` · ${activity.active}개 작업 중` : '';
  const total = activity.total === null ? '' : ` / ${activity.total}개`;
  return `${count}${total}${active}`;
}

export function ActivityProgress({ activity }: { activity: ProductActivity }) {
  const known = activity.completed !== null && activity.total !== null && activity.total > 0;
  return known
    ? createElement('progress', { value: activity.completed, max: activity.total })
    : createElement('progress', { 'aria-label': '진행 중' });
}
