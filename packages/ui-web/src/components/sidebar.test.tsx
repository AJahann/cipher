import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { Sidebar } from './sidebar';

describe(Sidebar, () => {
  it('names each contact by username only, not avatar initials', () => {
    render(
      <Sidebar
        users={[
          { id: '1', username: 'bob' },
          { id: '2', username: 'سارا' },
        ]}
        activeUserId='1'
        onSelect={vi.fn()}
      />,
    );

    const nav = screen.getByRole('complementary', { name: 'Conversations' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'bob' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'سارا' })).toBeInTheDocument();
  });

  it('keeps the pending suffix outside the isolated username', () => {
    render(
      <Sidebar
        users={[{ id: '2', username: 'سارا' }]}
        pendingUserId='2'
        onSelect={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: 'سارا · opening…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('bdi')).toHaveTextContent(/^سارا$/);
  });
});
