import { test, expect } from './fixtures';

// After both are unlocked, Alice sees Bob in the sidebar from useUsersList() --
// no message sent. Instantiating bobPage makes "both unlocked" literal.
test('both unlocked: alice sees bob in the sidebar without sending', async ({
  alicePage,
  bobPage,
  bobUsername,
}) => {
  // Touch bobPage so the fixture actually runs (registers/unlocks bob).
  await expect(bobPage.getByText('conversations')).toBeVisible();

  await expect(alicePage.getByRole('button', { name: bobUsername })).toBeVisible();
});
