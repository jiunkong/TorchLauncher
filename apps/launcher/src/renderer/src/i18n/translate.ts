import type { createTranslator } from '@torchlauncher/core/i18n';
import type { launcherTranslations } from './catalog.js';

export type Translate = ReturnType<typeof createTranslator<typeof launcherTranslations>>;
