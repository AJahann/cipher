import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatHeader } from './chat-header';

describe(ChatHeader, () => {
  it('uses the contact name as the page heading', () => {
    render(<ChatHeader title='bob' isConnected />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'bob' }),
    ).toBeInTheDocument();
  });

  it('opens keyboard help, traps focus, closes with Escape, and restores focus', async () => {
    const user = userEvent.setup();
    render(<ChatHeader isConnected />);

    const trigger = screen.getByRole('button', {
      name: 'Keyboard shortcuts',
    });
    trigger.focus();
    await user.keyboard('{Enter}');

    const dialog = screen.getByRole('dialog', {
      name: 'Keyboard shortcuts',
    });
    const close = screen.getByRole('button', {
      name: 'Close keyboard shortcuts',
    });

    expect(dialog).toBeInTheDocument();
    expect(close).toHaveFocus();

    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
