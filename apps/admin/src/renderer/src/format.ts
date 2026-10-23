import type { Locale } from '@torchlauncher/core/i18n';

export function formatDateTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
export const loaderLabel = (kind: 'fabric' | 'neoforge') =>
  kind === 'fabric' ? 'Fabric' : 'NeoForge';
