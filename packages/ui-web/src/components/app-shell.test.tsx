import { render, screen } from '@testing-library/react';
import { EmptyState } from './app-shell';

describe(EmptyState, () => {
  it('is the main landmark with a level-one heading', () => {
    render(<EmptyState />);
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', {
        level: 1,
        name: '// select a conversation to begin',
      }),
    );
  });
});
