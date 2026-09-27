import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AuthForm } from './auth-form';

const resolved = () => Promise.resolve();

describe(AuthForm, () => {
  describe('login mode', () => {
    it('calls onLogin with the submitted username and passphrase', async () => {
      const onLogin = vi.fn().mockResolvedValue(undefined);
      render(<AuthForm onLogin={onLogin} onRegister={resolved} />);

      await userEvent.type(screen.getByLabelText('username'), 'ashkan');
      await userEvent.type(screen.getByLabelText('passphrase'), 's3cr3t');
      await userEvent.click(
        screen.getByRole('button', { name: 'authenticate' }),
      );

      expect(onLogin).toHaveBeenCalledWith('ashkan', 's3cr3t');
    });
  });

  describe('register mode', () => {
    async function switchToRegister() {
      await userEvent.click(screen.getByRole('button', { name: 'register' }));
    }

    it('shows "Create account" heading and a confirm passphrase field', async () => {
      render(<AuthForm onLogin={resolved} onRegister={resolved} />);

      await switchToRegister();

      expect(
        screen.getByRole('heading', { name: 'Create account' }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('confirm passphrase')).toBeInTheDocument();
    });

    it('shows an error and does not call onRegister when passphrases do not match', async () => {
      const onRegister = vi.fn();
      render(<AuthForm onLogin={resolved} onRegister={onRegister} />);

      await switchToRegister();
      await userEvent.type(screen.getByLabelText('username'), 'ashkan');
      await userEvent.type(screen.getByLabelText('passphrase'), 's3cr3t');
      await userEvent.type(
        screen.getByLabelText('confirm passphrase'),
        'wr0ng',
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'generate keys + register' }),
      );

      expect(screen.getByText('passphrases do not match')).toBeInTheDocument();
      expect(onRegister).not.toHaveBeenCalled();
    });
  });
});
