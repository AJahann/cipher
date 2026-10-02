import { render, screen } from '@testing-library/react';
import { LoadingScreen } from './loading-screen';

describe(LoadingScreen, () => {
  it('stands alone as a page: main landmark with a level-one heading', () => {
    render(<LoadingScreen message='decrypting...' />);
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'decrypting...' }),
    );
  });
});
