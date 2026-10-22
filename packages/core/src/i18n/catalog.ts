export type Locale = 'en' | 'ko';

export type TranslationCatalog = Record<string, string>;

type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

type TranslationArgs<S extends string> = [Placeholders<S>] extends [never]
  ? []
  : [values: Record<Placeholders<S>, string | number>];

export function defineTranslations<const English extends TranslationCatalog>(
  english: English,
  korean: { [Key in keyof English]: string },
) {
  return { en: english, ko: korean } as const;
}

export type Catalogs = Record<Locale, TranslationCatalog>;
export type TranslationKey<C extends Catalogs> = keyof C['en'] & string;

export function createTranslator<const C extends Catalogs>(catalogs: C, locale: Locale) {
  return function translate<Key extends TranslationKey<C>>(
    key: Key,
    ...args: TranslationArgs<C['en'][Key] & string>
  ): string {
    const template = catalogs[locale][key] ?? key;
    const values = args[0] as Record<string, string | number> | undefined;
    return template.replace(/\{([a-zA-Z][\w]*)\}/g, (match, name: string) => {
      const value = values?.[name];
      return value === undefined ? match : String(value);
    });
  };
}

export function findCatalogMismatches(catalogs: Catalogs): string[] {
  const englishKeys = Object.keys(catalogs.en).sort();
  const koreanKeys = Object.keys(catalogs.ko).sort();
  const mismatches = new Set<string>();

  for (const key of englishKeys) {
    if (!(key in catalogs.ko)) mismatches.add(`ko missing key: ${key}`);
    const englishNames = placeholders(catalogs.en[key] ?? '');
    const koreanNames = placeholders(catalogs.ko[key] ?? '');
    if (englishNames.join('\0') !== koreanNames.join('\0')) {
      mismatches.add(`placeholder mismatch: ${key}`);
    }
  }
  for (const key of koreanKeys) {
    if (!(key in catalogs.en)) mismatches.add(`en missing key: ${key}`);
  }
  return [...mismatches].sort();
}

function placeholders(template: string): string[] {
  return [
    ...new Set([...template.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((match) => match[1] ?? '')),
  ].sort();
}
