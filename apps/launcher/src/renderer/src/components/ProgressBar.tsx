/** Styled bar: a ratio only for measured counts, otherwise an indeterminate animation. */
export function ProgressBar({
  measured,
  unknownLabel,
  label,
}: {
  measured: { completed: number; total: number } | null;
  unknownLabel: string;
  label?: string;
}) {
  if (!measured || measured.total <= 0)
    return (
      <div className="progress indet" role="progressbar" aria-label={unknownLabel}>
        <i />
      </div>
    );
  const percent = Math.min(100, Math.max(0, (measured.completed / measured.total) * 100));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={measured.total}
      aria-valuenow={measured.completed}
    >
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}
