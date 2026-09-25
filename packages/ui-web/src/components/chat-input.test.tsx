import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';
import { ChatInput } from './chat-input';

function Setup({ onSend = () => {} }: { onSend?: () => void }) {
  const [value, setValue] = useState('');
  return <ChatInput value={value} onChange={setValue} onSend={onSend} />;
}

describe(ChatInput, () => {
  it('send button has an accessible name', () => {
    render(<Setup />);
    expect(
      screen.getByRole('button', { name: 'Send message' }),
    ).toBeInTheDocument();
  });

  it('send button is disabled when the textarea is empty', () => {
    render(<Setup />);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('clicking the send button calls onSend', async () => {
    const onSend = vi.fn();
    render(<Setup onSend={onSend} />);
    await userEvent.type(screen.getByRole('textbox'), 'Hello');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledOnce();
  });

  describe('keyboard', () => {
    it('Enter calls onSend', async () => {
      const onSend = vi.fn();
      render(<Setup onSend={onSend} />);
      await userEvent.type(screen.getByRole('textbox'), 'Hello');
      await userEvent.keyboard('{Enter}');
      expect(onSend).toHaveBeenCalledOnce();
    });

    it('Shift+Enter does not call onSend', async () => {
      const onSend = vi.fn();
      render(<Setup onSend={onSend} />);
      await userEvent.type(screen.getByRole('textbox'), 'Hello');
      await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
      expect(onSend).not.toHaveBeenCalled();
    });
  });
});
