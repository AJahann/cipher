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
    await userEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
