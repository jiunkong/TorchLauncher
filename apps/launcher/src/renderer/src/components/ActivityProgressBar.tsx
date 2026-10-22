import type { ProductActivity } from '../../../shared/product';
import { activityKnown } from '../activity';

/** Styled bar: a ratio only for measured counts, otherwise an indeterminate animation. */
export function ActivityProgressBar({
  activity,
  progress,
  unknownLabel,
}: {
  activity: ProductActivity | null;
  progress: { completed: number; total: number } | null;
  unknownLabel: string;
}) {
  const measured = activity
    ? activityKnown(activity)
      ? { completed: activity.completed ?? 0, total: activity.total ?? 1 }
      : null
    : progress;
  if (!measured)
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
      aria-valuemin={0}
      aria-valuemax={measured.total}
      aria-valuenow={measured.completed}
    >
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}
