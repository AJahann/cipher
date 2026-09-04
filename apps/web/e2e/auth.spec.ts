import { test, expect } from './fixtures';

test('open conversation -> send -> receive', async ({
  alicePage,
  bobPage,
  aliceUsername,
  bobUsername,
}) => {
  const ts = Date.now();
  await alicePage.getByRole('button', { name: bobUsername }).click();
  await alicePage.getByRole('textbox').fill(`hello from alice ${ts}`);
  await alicePage.getByRole('button', { name: 'Send message' }).click();

  await expect(
    alicePage
      .getByRole('paragraph')
      .filter({ hasText: `hello from alice ${ts}` }),
  ).toBeVisible();

  await bobPage.getByRole('button', { name: aliceUsername }).click();

  await expect(
    bobPage
      .getByRole('paragraph')
      .filter({ hasText: `hello from alice ${ts}` }),
  ).toBeVisible();
});
