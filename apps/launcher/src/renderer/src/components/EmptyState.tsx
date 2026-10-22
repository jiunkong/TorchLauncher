import type { ReactNode } from 'react';

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`page-panel ${className}`}>{children}</div>;
}

export function EmptyState({
  title,
  description,
  action,
  testId,
}: {
  title: string;
  description: string;
  action: string;
  testId?: string | undefined;
}) {
  return (
    <section className="empty-state" aria-label="준비되지 않은 기능">
      <span className="empty-icon" aria-hidden="true">
        ✦
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      <button className="button button-primary" type="button" data-testid={testId} disabled>
        {action}
      </button>
      <span className="availability">아직 사용할 수 없습니다</span>
    </section>
  );
}
