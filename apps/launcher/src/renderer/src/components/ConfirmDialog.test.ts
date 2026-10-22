import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

const render = (props: { danger?: boolean; disabled?: boolean }) =>
  renderToStaticMarkup(
    createElement(ConfirmDialog, {
      idPrefix: 'sample',
      title: 'T',
      body: 'B',
      cancelLabel: 'Cancel',
      confirmLabel: 'Go',
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      ...props,
    }),
  );

it('renders a labelled modal dialog with cancel focused first and a normal confirm', () => {
  const html = render({});
  expect(html).toContain('role="dialog"');
  expect(html).toContain('aria-modal="true"');
  expect(html).toContain('aria-labelledby="sample-title"');
  expect(html).toContain('data-testid="sample-dialog"');
  expect(html.indexOf('data-autofocus')).toBeLessThan(html.indexOf('sample-confirm'));
  expect(html).toContain('class="btn primary"');
  expect(html).not.toContain('disabled');
});

it('uses the danger style and disables confirming when requested', () => {
  const html = render({ danger: true, disabled: true });
  expect(html).toContain('btn solid-danger');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="sample-confirm"/);
});
