import { test, expect } from '@playwright/test';
import {
  contact,
  openThreadWith,
  register,
  sendMessage,
  uniqueUsername,
} from './helpers';

/**
 * Regression coverage for the stale contact list.
 *
 * The contact list is the user directory, fetched once per session. Before the
 * socket fan-out fix an already-connected client never learned about new
 * accounts or incoming messages, so a user who registered first was stuck with
 * whatever list they loaded at login until they refreshed the page.
 */
test.describe('contact list realtime sync', () => {
  test('a newly registered user appears without a reload', async ({
    browser,
  }) => {
    const alice = uniqueUsername('alice');
    const bob = uniqueUsername('bob');

    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();

    try {
      const alicePage = await aliceCtx.newPage();
      const bobPage = await bobCtx.newPage();

      // Alice registers first, so her directory snapshot cannot contain Bob.
      await register(alicePage, alice);
      await expect(contact(alicePage, bob)).toHaveCount(0);

      // Bob registers second. Alice must learn about him over the socket.
      await register(bobPage, bob);

      await expect(contact(alicePage, bob)).toBeVisible();
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });

  test('an incoming message reaches a recipient who never opened the thread', async ({
    browser,
  }) => {
    const alice = uniqueUsername('alice');
    const bob = uniqueUsername('bob');
    const text = `ping-${Date.now()}`;

    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();

    try {
      const alicePage = await aliceCtx.newPage();
      const bobPage = await bobCtx.newPage();

      await register(alicePage, alice);
      await register(bobPage, bob);

      // Bob starts the thread and sends. Alice has never clicked Bob, so her
      // client never joined the conversation room — delivery has to come
      // through her personal room via `conversation:updated`.
      await openThreadWith(bobPage, alice);
      await sendMessage(bobPage, text);

      // Alice, still sitting on the empty state and without reloading.
      await expect(contact(alicePage, bob)).toBeVisible();

      await openThreadWith(alicePage, bob);
      await expect(alicePage.getByText(text)).toBeVisible();
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });
});
