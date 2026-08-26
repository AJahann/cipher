import { render, screen } from '@testing-library/react';

import { EmptyState } from '@chat-app/ui-web';

describe('EmptyState', () => {
  it('renders the placeholder comment text', () => {
    render(<EmptyState />);

    expect(
      screen.getByText('// select a conversation to begin'),
    ).toBeInTheDocument();
  });

  it('renders as a main landmark', () => {
    render(<EmptyState />);

    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
