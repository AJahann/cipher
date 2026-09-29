import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AuthForm } from './auth-form';

const resolved = () => Promise.resolve();

describe(AuthForm, () => {
  describe('login mode', () => {
    it('has a logical tab order and submits with Enter', async () => {
      const user = userEvent.setup();
      const onLogin = vi.fn().mockResolvedValue(undefined);
      render(<AuthForm onLogin={onLogin} onRegister={resolved} />);

      await user.tab();
      expect(screen.getByRole('button', { name: 'login' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'register' })).toHaveFocus();
      await user.tab();
      expect(screen.getByLabelText('username')).toHaveFocus();
      await user.type(screen.getByLabelText('username'), 'ashkan');
      await user.tab();
      expect(screen.getByLabelText('passphrase')).toHaveFocus();
      await user.type(screen.getByLabelText('passphrase'), 's3cr3t');
      await user.keyboard('{Enter}');

      expect(onLogin).toHaveBeenCalledWith('ashkan', 's3cr3t');
    });

    it('associates validation errors and focuses the first invalid field', async () => {
      const user = userEvent.setup();
      render(<AuthForm onLogin={resolved} onRegister={resolved} />);

      await user.click(screen.getByRole('button', { name: 'authenticate' }));

      const username = screen.getByLabelText('username');
      expect(username).toHaveAttribute('aria-invalid', 'true');
      expect(username).toHaveAccessibleDescription('username is required');
      await waitFor(() => expect(username).toHaveFocus());
    });

    it('exposes pending state and prevents duplicate submission', async () => {
      const user = userEvent.setup();
      let resolveLogin!: () => void;
      const onLogin = vi.fn(
        () => new Promise<void>((resolve) => (resolveLogin = resolve)),
      );
      render(<AuthForm onLogin={onLogin} onRegister={resolved} />);

      await user.type(screen.getByLabelText('username'), 'ashkan');
      await user.type(screen.getByLabelText('passphrase'), 's3cr3t');
      await user.keyboard('{Enter}{Enter}');

      expect(onLogin).toHaveBeenCalledOnce();
      expect(screen.getByRole('status')).toHaveTextContent('Signing in');
      expect(
        screen.getByRole('button', { name: 'authenticating...' }),
      ).toBeDisabled();
      resolveLogin();
      await waitFor(() =>
        expect(screen.queryByRole('status')).not.toBeInTheDocument(),
      );
    });

    it('focuses the announced error summary after authentication fails', async () => {
      const user = userEvent.setup();
      const onLogin = vi.fn().mockRejectedValue(new Error('invalid credentials'));
      render(<AuthForm onLogin={onLogin} onRegister={resolved} />);

      await user.type(screen.getByLabelText('username'), 'ashkan');
      await user.type(screen.getByLabelText('passphrase'), 'wrong');
      await user.keyboard('{Enter}');

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        'Authentication failed: invalid credentials',
      );
      await waitFor(() => expect(alert).toHaveFocus());
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

      const confirm = screen.getByLabelText('confirm passphrase');
      expect(confirm).toHaveAccessibleDescription('passphrases do not match');
      await waitFor(() => expect(confirm).toHaveFocus());
      expect(onRegister).not.toHaveBeenCalled();
    });
  });
});
