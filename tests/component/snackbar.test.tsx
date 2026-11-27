import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Snackbar } from '../../apps/admin/src/Snackbar.js';

test('a message can be dismissed and a later message expires without moving focus', () => {
  vi.useFakeTimers();
  try {
    const { rerender } = render(<Snackbar message="" />);
    expect(screen.getByRole('status').textContent).toBe('');
    rerender(<Snackbar message="Fiktive Änderung gespeichert." />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Fiktive Änderung gespeichert.');
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'Meldung schließen' }));
    expect(screen.getByRole('status').textContent).toBe('');
    rerender(<Snackbar message="Fiktive Notiz gespeichert." />);
    expect(screen.getByRole('status').textContent).toBe(
      'Fiktive Notiz gespeichert.',
    );
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByRole('status').textContent).toBe('');
  } finally {
    vi.useRealTimers();
  }
});
