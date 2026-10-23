/**
 * Sample data for the game-settings page layout. This is NOT read from a game folder: the real
 * preset loading (options.txt, mod config files, pack import) arrives with STUDIO-MAIN/UI-02 and
 * replaces this module. Names, keys and sizes below are illustrative only.
 */
import type { Policy3 } from '../components/ui';

export interface KeyEntry {
  /** Option key as written in options.txt, e.g. key_key.jump. */
  id: string;
  /** Display name, null when no translation was found (shows the raw key). */
  name: string | null;
  value: string;
  /** Key owner: true for keys added by a mod. */
  mod: boolean;
  /** Group heading; empty for mod keys without a known mod (shown as 'other mods'). */
  group: string;
}
export interface OptionEntry {
  id: string;
  name: string;
  value: string;
}
export interface PackEntry {
  id: string;
  file: string;
  note: string;
  size: string;
  color: string;
  initial: string;
}

export const sampleKeys: KeyEntry[] = [
  { id: 'key_key.jump', name: '점프', value: 'Space', mod: false, group: '이동' },
  { id: 'key_key.forward', name: '앞으로 이동', value: 'W', mod: false, group: '이동' },
  { id: 'key_key.sneak', name: '웅크리기', value: 'Left Shift', mod: false, group: '이동' },
  {
    id: 'key_key.inventory',
    name: '인벤토리 열기/닫기',
    value: 'E',
    mod: false,
    group: '인벤토리',
  },
  { id: 'key_key.drop', name: '선택한 아이템 버리기', value: 'Q', mod: false, group: '인벤토리' },
  {
    id: 'key_key.exampleminimap.fullscreen',
    name: '지도 크게 보기',
    value: 'M',
    mod: true,
    group: '예시 미니맵 모드',
  },
  {
    id: 'key_key.exampleminimap.zoom_in',
    name: '지도 확대',
    value: '=',
    mod: true,
    group: '예시 미니맵 모드',
  },
  {
    id: 'key_key.examplemod.open_menu',
    name: null,
    value: 'G',
    mod: true,
    group: '',
  },
];

export const sampleOptions: OptionEntry[] = [
  { id: 'renderDistance', name: '렌더 거리', value: '12' },
  { id: 'fov', name: '시야각(FOV)', value: '70' },
  { id: 'maxFps', name: '최대 프레임', value: '120' },
  { id: 'guiScale', name: 'GUI 크기', value: '0 (자동)' },
  { id: 'soundCategory_master', name: '주 음량', value: '1.0' },
  { id: 'soundCategory_music', name: '음악 음량', value: '0.3' },
  { id: 'gamma', name: '밝기', value: '0.5' },
];

export const samplePacks: PackEntry[] = [
  {
    id: 'server-pack',
    file: 'server-pack.zip',
    note: '서버 필수 팩',
    size: '18 MB',
    color: '#2f6b4f',
    initial: 'S',
  },
  {
    id: 'hd-textures',
    file: 'hd-textures.zip',
    note: '고해상도 텍스처',
    size: '42 MB',
    color: '#4a4f8f',
    initial: 'H',
  },
  {
    id: 'light-pack',
    file: 'light-pack.zip',
    note: '가벼운 UI 팩',
    size: '6 MB',
    color: '#8f5a2f',
    initial: 'L',
  },
];

export const sampleShaders: PackEntry[] = [
  {
    id: 'complementary',
    file: 'ComplementaryReimagined_r5.zip',
    note: '',
    size: '3.1 MB',
    color: '#7a4fa3',
    initial: 'C',
  },
  { id: 'bsl', file: 'BSL_v10.zip', note: '', size: '2.4 MB', color: '#2f6b8f', initial: 'B' },
  {
    id: 'rethinking',
    file: 'Rethinking_Voxels.zip',
    note: '',
    size: '8.9 MB',
    color: '#8f4a4a',
    initial: 'R',
  },
];

export const sampleShaderOptionCount = 12;
export const samplePresetSource = {
  files: ['options.txt', 'config/iris.properties'],
  keyCount: 38,
  modKeyCount: 6,
};

export type Policies = Record<string, Policy3>;
