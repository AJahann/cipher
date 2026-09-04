import { test, expect } from './fixtures';

test('both unlocked: alice sees bob in the sidebar without sending', async ({
  alicePage,
  bobPage,
  bobUsername,
}) => {
  await expect(bobPage.getByText('conversations')).toBeVisible();

  await expect(
    alicePage.getByRole('button', { name: bobUsername }),
  ).toBeVisible();
});
