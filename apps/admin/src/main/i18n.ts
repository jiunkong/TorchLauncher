import type { Locale } from '@torchlauncher/core/i18n';
import { createTranslator, defineTranslations, normalizeLocale } from '@torchlauncher/core/i18n';

export const studioMainTranslations = defineTranslations(
  {
    defaultServerName: 'New server',
    'dialog.projectOpen': 'Open project folder',
    'dialog.projectNew': 'Select new project folder',
    'dialog.filesOpen': 'Select files to add',
    'dialog.iconOpen': 'Choose app icon',
    'dialog.backgroundOpen': 'Choose home background',
    'dialog.keyBackupOpen': 'Choose signing key backup file',
    'dialog.optionsOpen': 'Choose options.txt',
    'dialog.gameFolderOpen': 'Choose a folder where the game has been run once',
    'dialog.resourcePackOpen': 'Choose a resource pack (.zip)',
    'dialog.shaderPackOpen': 'Choose a shader pack (.zip)',
    'dialog.modOpen': 'Choose a mod (.jar)',
    'dialog.packSave': 'Create torchpack',
    'dialog.keyBackupSave': 'Save signing key backup',
    'dialog.zipSave': 'Save launcher ZIP',
    'dialog.brandingFilter': 'Branding image',
    'dialog.keyBackupFilter': 'Signing key backup',
    'dialog.optionsFilter': 'options.txt file',
    'dialog.zipFilter': 'ZIP file',
    'dialog.modFilter': 'Java archive',
    'dialog.deploymentFileFilter': 'Deployment file',
  },
  {
    defaultServerName: '새 서버',
    'dialog.projectOpen': '프로젝트 폴더 열기',
    'dialog.projectNew': '새 프로젝트 폴더 선택',
    'dialog.filesOpen': '추가할 파일 선택',
    'dialog.iconOpen': '앱 아이콘 선택',
    'dialog.backgroundOpen': '홈 배경 선택',
    'dialog.keyBackupOpen': '서명 키 백업 파일 선택',
    'dialog.optionsOpen': 'options.txt 선택',
    'dialog.gameFolderOpen': '게임을 한 번 실행한 폴더 선택',
    'dialog.resourcePackOpen': '리소스팩(.zip) 선택',
    'dialog.shaderPackOpen': '셰이더팩(.zip) 선택',
    'dialog.modOpen': '모드(.jar) 선택',
    'dialog.packSave': 'torchpack 생성',
    'dialog.keyBackupSave': '서명 키 백업 저장',
    'dialog.zipSave': '런처 내보내기 ZIP 저장',
    'dialog.brandingFilter': '브랜딩 이미지',
    'dialog.keyBackupFilter': '서명 키 백업',
    'dialog.optionsFilter': 'options.txt 파일',
    'dialog.zipFilter': 'ZIP 파일',
    'dialog.modFilter': 'Java 아카이브',
    'dialog.deploymentFileFilter': '배포 파일',
  },
);

export type StudioMainLocale = Locale;
export function resolveMainLocale(locale: string): StudioMainLocale {
  return normalizeLocale(locale) === 'ko' ? 'ko' : 'en';
}
export function studioMainText(locale: StudioMainLocale) {
  return createTranslator(studioMainTranslations, locale);
}
