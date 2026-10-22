/** Binary size with one decimal; counts are shown exactly elsewhere. */
export function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Math.max(0, value);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(size)} B` : `${size.toFixed(1)} ${units[unit]}`;
}
