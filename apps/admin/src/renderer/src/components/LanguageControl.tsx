import type { Locale, LocalePreference } from '@torchlauncher/core/i18n';

export type LanguageChoice = 'auto' | Locale;

/** Each choice is written in its own language so it can be found when the UI is in the wrong one. */
export const languageChoices: { value: LanguageChoice; label: string; short: string }[] = [
  { value: 'auto', label: '자동 · Auto', short: 'Auto' },
  { value: 'ko', label: '한국어', short: '한국어' },
  { value: 'en', label: 'English', short: 'English' },
];

export function activeChoice(preference: LocalePreference): LanguageChoice {
  return preference.mode === 'auto' ? 'auto' : preference.locale;
}

/** Language setting: automatic (follow the system) or an explicit language; applies immediately. */
export function LanguageControl({
  preference,
  onSelect,
  compact = false,
}: {
  preference: LocalePreference;
  onSelect(choice: LanguageChoice): void;
  compact?: boolean;
}) {
  const active = activeChoice(preference);
  return (
    <div
      className={`seg lang${compact ? ' compact' : ''}`}
      role="radiogroup"
      aria-label="Language / 언어"
      data-testid="language-control"
    >
      {languageChoices.map((choice) => (
        // biome-ignore lint/a11y/useSemanticElements: segmented control of toggle buttons
        <button
          key={choice.value}
          type="button"
          role="radio"
          aria-checked={active === choice.value}
          className={active === choice.value ? 'on' : undefined}
          lang={choice.value === 'auto' ? undefined : choice.value}
          data-choice={choice.value}
          onClick={() => onSelect(choice.value)}
        >
          {compact ? choice.short : choice.label}
        </button>
      ))}
    </div>
  );
}
