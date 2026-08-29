import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('derives its accessible name from children', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  describe('when isLoading', () => {
    it('replaces children with the default loading text and disables the button', () => {
      render(<Button isLoading>Save</Button>);
      expect(
        screen.getByRole('button', { name: 'please wait...' }),
      ).toBeDisabled();
    });

    it('uses a custom loadingText when provided', () => {
      render(
        <Button isLoading loadingText='Saving...'>
          Save
        </Button>,
      );
      expect(
        screen.getByRole('button', { name: 'Saving...' }),
      ).toBeInTheDocument();
    });

    it('does not fire onClick when clicked', async () => {
      const handleClick = vi.fn();
      render(
        <Button isLoading onClick={handleClick}>
          Save
        </Button>,
      );
      await userEvent.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });
  });
});
