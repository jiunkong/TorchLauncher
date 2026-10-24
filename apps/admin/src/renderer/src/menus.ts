import type { Locale, LocalePreference } from '@torchlauncher/core/i18n';
import { activeChoice, type LanguageChoice, languageChoices } from './components/LanguageControl';
import type { MenuDefinition } from './components/MenuBar';
import type { useStudioLocale } from './i18n';

type Translator = ReturnType<typeof useStudioLocale>['t'];

export interface MenuActions {
  newProject(): void;
  openProject(): void;
  save(): void;
  saveAs(): void;
  revealProject(): void;
  closeProject(): void;
  exit(): void;
  language(choice: LanguageChoice): void;
  about(): void;
}

/** File / View / Help. Items that do not apply are disabled (aria-disabled), never hidden. */
export function buildMenus(options: {
  t: Translator;
  hasProject: boolean;
  busy: boolean;
  preference: LocalePreference;
  actions: MenuActions;
}): MenuDefinition[] {
  const { t, hasProject, busy, preference, actions } = options;
  const active = activeChoice(preference);
  return [
    {
      id: 'file',
      label: t('menu.file'),
      rows: [
        {
          id: 'new',
          label: t('project.new'),
          shortcut: 'Ctrl+N',
          disabled: busy,
          onSelect: actions.newProject,
        },
        {
          id: 'open',
          label: t('menu.open'),
          shortcut: 'Ctrl+O',
          disabled: busy,
          onSelect: actions.openProject,
        },
        {
          id: 'save',
          label: t('save.save'),
          shortcut: 'Ctrl+S',
          disabled: busy || !hasProject,
          onSelect: actions.save,
        },
        {
          id: 'saveAs',
          label: t('save.saveAs'),
          shortcut: 'Ctrl+Shift+S',
          disabled: busy || !hasProject,
          onSelect: actions.saveAs,
        },
        {
          id: 'revealProject',
          label: t('menu.revealProject'),
          disabled: busy || !hasProject,
          onSelect: actions.revealProject,
        },
        { separator: true },
        {
          id: 'close',
          label: t('menu.closeProject'),
          shortcut: 'Ctrl+W',
          disabled: busy || !hasProject,
          onSelect: actions.closeProject,
        },
        { separator: true },
        { id: 'exit', label: t('menu.exit'), onSelect: actions.exit },
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      rows: [
        { caption: 'Language / 언어' },
        ...languageChoices.map((choice) => ({
          id: `lang-${choice.value}`,
          label: choice.label,
          radio: true,
          checked: active === choice.value,
          onSelect: () => actions.language(choice.value),
        })),
      ],
    },
    {
      id: 'help',
      label: t('menu.help'),
      rows: [{ id: 'about', label: t('menu.about'), onSelect: actions.about }],
    },
  ];
}

export type { Locale };

/** Ctrl/Cmd shortcut of the File menu, or null when the key event is not one. */
export function shortcutAction(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}):
  | keyof Pick<MenuActions, 'newProject' | 'openProject' | 'save' | 'saveAs' | 'closeProject'>
  | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 's') return event.shiftKey ? 'saveAs' : 'save';
  if (event.shiftKey) return null;
  if (key === 'n') return 'newProject';
  if (key === 'o') return 'openProject';
  if (key === 'w') return 'closeProject';
  return null;
}
