import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MessageBubble } from './message-bubble';

describe(MessageBubble, () => {
  it('renders one retryable failed bubble', async () => {
    const onRetry = vi.fn();

    render(
      <MessageBubble
        msg={{
          id: 'client-message-id',
          clientMessageId: 'client-message-id',
          senderId: 'sender-id',
          text: 'retry me',
          time: '12:00',
          isMine: true,
          deliveryStatus: 'failed',
        }}
        onRetry={onRetry}
      />,
    );

    expect(screen.getAllByText('retry me')).toHaveLength(1);
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Retry sending message: retry me',
      }),
    );
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('resolves its own direction for mixed Persian/English text', () => {
    const text = 'سلام! این پیام با React 19 و Next.js تست شد.';
    render(
      <MessageBubble
        msg={{
          id: 'm1',
          senderId: 'sender-id',
          text,
          time: '12:00',
          isMine: false,
        }}
        peerName='bob'
      />,
    );

    expect(screen.getByText(text)).toHaveAttribute('dir', 'auto');
  });

  it('names the sender for assistive tech instead of exposing avatar initials', () => {
    const { rerender } = render(
      <MessageBubble
        msg={{
          id: 'm1',
          senderId: 'a1b2c3',
          text: 'hello',
          time: '12:00',
          isMine: false,
        }}
        peerName='bob'
      />,
    );
    expect(screen.getByText('bob:')).toBeInTheDocument();
    expect(screen.queryByText('A1')).not.toBeInTheDocument();
    expect(
      screen.getByText('BO').closest('[aria-hidden="true"]'),
    ).not.toBeNull();

    rerender(
      <MessageBubble
        msg={{
          id: 'm2',
          senderId: 'me',
          text: 'hi',
          time: '12:01',
          isMine: true,
        }}
        peerName='bob'
      />,
    );
    expect(screen.getByText('You:')).toBeInTheDocument();
  });
});
