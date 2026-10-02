import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { UnlockForm } from './unlock-form';

describe(UnlockForm, () => {
  it('renders inside the main landmark', () => {
    render(<UnlockForm onUnlock={vi.fn()} />);
    const main = screen.getByRole('main');
    expect(main).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Unlock session' }),
    );
    expect(main).toContainElement(screen.getByLabelText('passphrase'));
  });
});
