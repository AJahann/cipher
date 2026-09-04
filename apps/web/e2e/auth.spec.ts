import { test, expect } from './fixtures';

// Day 5 journey, now on the fixtures. No register() in this file: both pages
// arrive already registered + unlocked, keys in RAM, sitting on /chat.
test('open conversation -> send -> receive', async ({
  alicePage,
  bobPage,
  aliceUsername,
  bobUsername,
}) => {
  // Alice opens Bob and sends. The contact button auto-waits until it exists.
  await alicePage.getByRole('button', { name: bobUsername }).click();
  await alicePage.getByRole('textbox').fill('hello from alice');
  await alicePage.getByRole('button', { name: 'Send message' }).click();

  await expect(
    alicePage.getByRole('paragraph').filter({ hasText: 'hello from alice' }),
  ).toBeVisible();

  // Bob opens Alice and sees the same paragraph (realtime + on-open fetch).
  await bobPage.getByRole('button', { name: aliceUsername }).click();

  await expect(
    bobPage.getByRole('paragraph').filter({ hasText: 'hello from alice' }),
  ).toBeVisible();
});
