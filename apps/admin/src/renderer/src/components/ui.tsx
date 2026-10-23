import type { ReactNode } from 'react';
import { CheckIcon, CrossIcon, InfoIcon, WarnIcon } from './Icons';

export function PageHeader({
  eyebrow,
  title,
  lead,
  actions,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="hd">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {actions}
    </header>
  );
}

export function Note({
  tone,
  children,
  testId,
}: {
  tone?: 'warn' | 'ok' | undefined;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className={`note${tone ? ` ${tone}` : ''}`} data-testid={testId}>
      {tone === 'warn' ? <WarnIcon /> : tone === 'ok' ? <CheckIcon /> : <InfoIcon />}
      <span>{children}</span>
    </div>
  );
}

export function Chip({
  tone,
  children,
}: {
  tone?: 'ok' | 'warn' | 'on' | undefined;
  children: ReactNode;
}) {
  return <span className={`chip${tone ? ` ${tone}` : ''}`}>{children}</span>;
}

/** A pass/fail/pending row of the address and export checklists. */
export function CheckRow({
  status,
  label,
  detail,
  children,
}: {
  status: 'ok' | 'bad' | 'pending';
  label: string;
  detail?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <div className={`ck ${status}`} data-status={status}>
      {status === 'ok' ? (
        <CheckIcon />
      ) : status === 'bad' ? (
        <CrossIcon />
      ) : (
        <span className="ck-dot" />
      )}
      <span className="t">
        {label}
        {detail && <small>{detail}</small>}
      </span>
      {children}
    </div>
  );
}

export type Policy3 = 'none' | 'initial' | 'required';

/** 정하지 않음 / 최초 기본값 / 항상 고정 (settings policy `initial` and `required`). */
export function PolicyControl({
  value,
  onChange,
  labels,
  groupLabel,
  disabled,
}: {
  value: Policy3 | null;
  onChange(value: Policy3): void;
  labels: Record<Policy3, string>;
  groupLabel: string;
  disabled?: boolean;
}) {
  const cls: Record<Policy3, string> = { none: 'n0', initial: 'i', required: 'a' };
  return (
    <span className="pol3" role="radiogroup" aria-label={groupLabel}>
      {(['none', 'initial', 'required'] as const).map((item) => (
        // biome-ignore lint/a11y/useSemanticElements: segmented control of toggle buttons
        <button
          key={item}
          type="button"
          role="radio"
          aria-checked={value === item}
          disabled={disabled}
          className={value === item ? cls[item] : undefined}
          onClick={() => onChange(item)}
        >
          {labels[item]}
        </button>
      ))}
    </span>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="boxwrap">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={`box${checked ? ' on' : ''}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M5 12l5 5 9-10" />
        </svg>
      </span>
    </label>
  );
}
