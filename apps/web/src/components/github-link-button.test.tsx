import { cleanup, render, screen } from '@testing-library/react';
import { GitHubLinkButton } from './github-link-button';

vi.mock(import('../lib/data-layer/client'), () => ({ apiFetch: vi.fn() }));

afterEach(cleanup);

describe(GitHubLinkButton, () => {
  it('hides the action for linked accounts', () => {
    const { container } = render(<GitHubLinkButton linked={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the action for confirmed unlinked accounts', () => {
    render(<GitHubLinkButton linked={false} />);
    expect(
      screen.getByRole('button', {
        name: 'Link GitHub to this Cipher account',
      }),
    ).toBeVisible();
  });

  it('hides the action while status is unavailable', () => {
    const { container } = render(<GitHubLinkButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('removes the action when saved link status becomes linked', () => {
    const { container, rerender } = render(<GitHubLinkButton linked={false} />);
    rerender(<GitHubLinkButton linked={true} />);
    expect(container).toBeEmptyDOMElement();
  });
});
