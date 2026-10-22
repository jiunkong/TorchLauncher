import type { ProductActivity } from '../../shared/product';

/**
 * The launch pipeline in its real order. Components are grouped by the stage that works on them;
 * stages only ever advance during one operation, so parallel work in an earlier stage never moves
 * the display backwards.
 */
export type ActivityStage = 'info' | 'game' | 'loader' | 'sync';
export const stageOrder: readonly ActivityStage[] = ['info', 'game', 'loader', 'sync'];

const stageOfComponent: Record<ProductActivity['component'], ActivityStage> = {
  metadata: 'info',
  game: 'game',
  java: 'game',
  library: 'game',
  asset: 'game',
  logging: 'game',
  loader: 'loader',
  'server-mod': 'sync',
  'resource-pack': 'sync',
  'server-config': 'sync',
  'server-file': 'sync',
};

export function stageOf(activity: Pick<ProductActivity, 'phase' | 'component'>): ActivityStage {
  return activity.phase === 'planning' ? 'info' : stageOfComponent[activity.component];
}

/** The furthest stage reached so far; `null` activity keeps the previous value. */
export function advanceStage(
  reached: ActivityStage | null,
  activity: Pick<ProductActivity, 'phase' | 'component'> | null,
): ActivityStage | null {
  if (!activity) return reached;
  const next = stageOf(activity);
  return reached !== null && stageOrder.indexOf(reached) > stageOrder.indexOf(next)
    ? reached
    : next;
}

export function stageChips(
  current: ActivityStage | null,
): { id: ActivityStage; state: 'done' | 'now' | 'todo' }[] {
  const index = current === null ? -1 : stageOrder.indexOf(current);
  return stageOrder.map((id, position) => ({
    id,
    state: position < index ? 'done' : position === index ? 'now' : 'todo',
  }));
}

/** A ratio is shown only when both the completed and total counts were measured. */
export function activityKnown(activity: Pick<ProductActivity, 'completed' | 'total'>): boolean {
  return activity.completed !== null && activity.total !== null && activity.total > 0;
}

/**
 * What the progress panel may state for the current stage. Only the game-file stage has a plan
 * total, so only it can show "completed / total" and a ratio; server synchronization never does.
 * Activity from another stage (a straggler of parallel work) contributes nothing.
 */
export type StageMeasure =
  | { kind: 'ratio'; completed: number; total: number }
  | { kind: 'completed'; completed: number }
  | { kind: 'none' };

export function stageMeasure(stage: ActivityStage, activity: ProductActivity | null): StageMeasure {
  if (!activity || stageOf(activity) !== stage) return { kind: 'none' };
  if (stage === 'game' && activityKnown(activity))
    return { kind: 'ratio', completed: activity.completed ?? 0, total: activity.total ?? 1 };
  if (stage === 'sync' && activity.completed !== null)
    return { kind: 'completed', completed: activity.completed };
  return { kind: 'none' };
}
