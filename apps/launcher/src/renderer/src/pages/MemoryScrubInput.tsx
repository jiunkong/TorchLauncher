import type { PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef } from 'react';
import { memoryScrubThresholdPx, scrubMemoryMiB } from './memory';

type MemoryScrubInputProps = {
  value: string;
  label: string;
  unit: string;
  testId: string;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange(value: string): void;
};

type DragState = {
  pointerId: number;
  startX: number;
  startValue: number;
  originalValue: string;
  active: boolean;
  input: HTMLInputElement;
};

export function MemoryScrubInput({
  value,
  label,
  unit,
  testId,
  min,
  max,
  step,
  disabled,
  onChange,
}: MemoryScrubInputProps) {
  const dragRef = useRef<DragState | null>(null);
  const scrubEnabled = !disabled && max >= min;

  useEffect(
    () => () => {
      const drag = dragRef.current;
      if (drag?.input.hasPointerCapture(drag.pointerId)) {
        drag.input.releasePointerCapture(drag.pointerId);
      }
      dragRef.current = null;
    },
    [],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (!scrubEnabled || !event.isPrimary || event.button !== 0) return;
    const parsed = Number(value);
    const startValue = Number.isFinite(parsed) && parsed > 0 ? parsed * 1024 : min;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue,
      originalValue: value,
      active: false,
      input: event.currentTarget,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLInputElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !scrubEnabled) return;
    if (!drag.active && Math.abs(event.clientX - drag.startX) < memoryScrubThresholdPx) return;
    drag.active = true;
    event.preventDefault();
    onChange(String(scrubMemoryMiB(drag.startValue, event.clientX - drag.startX, min, max) / 1024));
  };

  const finishDrag = (event: ReactPointerEvent<HTMLInputElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (cancelled && drag.active) onChange(drag.originalValue);
  };

  return (
    <span className="input-unit memory-scrub">
      <input
        type="number"
        min={min / 1024}
        max={max / 1024}
        step={step / 1024}
        inputMode="decimal"
        value={value}
        aria-label={label}
        data-testid={testId}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishDrag(event, false)}
        onPointerCancel={(event) => finishDrag(event, true)}
        onLostPointerCapture={(event) => finishDrag(event, false)}
      />
      <span>{unit}</span>
    </span>
  );
}
