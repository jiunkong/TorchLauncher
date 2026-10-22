import { describe, expect, it } from 'vitest';
import type { ProductActivity } from '../../shared/product';
import {
  activityKnown,
  advanceStage,
  stageChips,
  stageMeasure,
  stageOf,
  stageOrder,
} from './activity';

const activity = (
  component: ProductActivity['component'],
  extra: Partial<ProductActivity> = {},
): ProductActivity => ({
  phase: 'downloading',
  component,
  active: 1,
  completed: null,
  total: null,
  ...extra,
});

describe('installation stages (real processing order)', () => {
  it('maps every component to one of the four stages', () => {
    const table: Array<[ProductActivity['component'], string]> = [
      ['metadata', 'info'],
      ['game', 'game'],
      ['java', 'game'],
      ['library', 'game'],
      ['asset', 'game'],
      ['logging', 'game'],
      ['loader', 'loader'],
      ['server-mod', 'sync'],
      ['resource-pack', 'sync'],
      ['server-config', 'sync'],
      ['server-file', 'sync'],
    ];
    for (const [component, stage] of table) expect(stageOf(activity(component))).toBe(stage);
    expect(stageOrder).toEqual(['info', 'game', 'loader', 'sync']);
  });

  it('treats planning as the information stage whatever the component', () => {
    expect(stageOf(activity('game', { phase: 'planning' }))).toBe('info');
  });

  it('never moves backwards when parallel work interleaves components', () => {
    let reached = advanceStage(null, activity('metadata', { phase: 'planning' }));
    expect(reached).toBe('info');
    reached = advanceStage(reached, activity('asset'));
    expect(reached).toBe('game');
    reached = advanceStage(reached, activity('java'));
    reached = advanceStage(reached, activity('loader'));
    expect(reached).toBe('loader');
    // A straggler from the game-file pool must not pull the display back.
    reached = advanceStage(reached, activity('library'));
    expect(reached).toBe('loader');
    reached = advanceStage(reached, activity('server-mod'));
    expect(reached).toBe('sync');
    expect(advanceStage(reached, null)).toBe('sync');
  });

  it('derives done, now, and todo from the stage alone', () => {
    expect(stageChips('loader').map((chip) => chip.state)).toEqual(['done', 'done', 'now', 'todo']);
    expect(stageChips(null).map((chip) => chip.state)).toEqual(['todo', 'todo', 'todo', 'todo']);
  });
});

describe('what a stage may claim to know', () => {
  it('shows completed / total for game files only when both were measured', () => {
    expect(stageMeasure('game', activity('asset', { completed: 3, total: 8 }))).toEqual({
      kind: 'ratio',
      completed: 3,
      total: 8,
    });
    expect(stageMeasure('game', activity('asset', { completed: 3, total: null }))).toEqual({
      kind: 'none',
    });
    expect(stageMeasure('game', activity('asset', { completed: null, total: 8 }))).toEqual({
      kind: 'none',
    });
  });

  it('never makes a ratio for server synchronization, even with numbers present', () => {
    expect(stageMeasure('sync', activity('server-mod', { completed: 4, total: 9 }))).toEqual({
      kind: 'completed',
      completed: 4,
    });
    expect(stageMeasure('sync', activity('server-mod'))).toEqual({ kind: 'none' });
  });

  it('ignores activity that belongs to another stage', () => {
    expect(stageMeasure('loader', activity('library', { completed: 9, total: 9 }))).toEqual({
      kind: 'none',
    });
  });

  it('reports a ratio only when both counts were measured', () => {
    expect(activityKnown({ completed: 3, total: 8 })).toBe(true);
    expect(activityKnown({ completed: 3, total: null })).toBe(false);
    expect(activityKnown({ completed: null, total: 8 })).toBe(false);
    expect(activityKnown({ completed: 0, total: 0 })).toBe(false);
  });
});
