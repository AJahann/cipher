// oxlint-disable no-await-in-loop
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { request, expect } from '@playwright/test';
import {
  E2EEncryption,
  STORAGE_KEY,
  wrapPrivateKey,
  type WrappedPrivateKey,
} from '@chat-app/shared/crypto';
import { env } from '../../../../env';
import { PASSPHRASE } from './auth-paths';

export interface AuthUsers {
  alice: string;
  bob: string;
}

export async function provisionUsers(directory: string): Promise<AuthUsers> {
  fs.mkdirSync(directory, { recursive: true });
  // Random per invocation, including restarted workers/retries; under the API's
  // 32-character username limit. Never reuse a session from a previous run.
  const suffix = randomUUID().replaceAll('-', '').slice(0, 20);
  const users = { alice: `alice-${suffix}`, bob: `bob-${suffix}` };
  for (const role of ['alice', 'bob'] as const) {
    const api = await request.newContext({ baseURL: env.NEXT_PUBLIC_API_URL });
    try {
      const pair = await E2EEncryption.generateKeyPair();
      let wrappedPrivateKey: WrappedPrivateKey;
      try {
        // Production implementation and Argon2id parameters, not fixture keys.
        wrappedPrivateKey = await wrapPrivateKey(pair.privateKey, PASSPHRASE);
      } finally {
        pair.privateKey.fill(0);
      }
      const response = await api.post('/auth/register', {
        headers: { Origin: new URL(env.PLAYWRIGHT_BASE_URL).origin },
        data: {
          username: users[role],
          password: PASSPHRASE,
          publicKey: pair.publicKeyB64,
          wrappedPrivateKey,
        },
      });
      expect(response.status(), 'API fixture registration must succeed').toBe(
        201,
      );
      const me = await api.get('/auth/me');
      expect(me.status()).toBe(200);
      expect((await me.json()).username).toBe(users[role]);
      const bundle = await api.get('/auth/key-bundle');
      expect(bundle.status()).toBe(200);
      expect(await bundle.json()).toEqual({
        publicKey: pair.publicKeyB64,
        wrappedPrivateKey,
      });
      const state = await api.storageState();
      expect(state.cookies.some((cookie) => cookie.name === 'sessionId')).toBe(
        true,
      );
      state.origins = [
        {
          origin: new URL(env.PLAYWRIGHT_BASE_URL).origin,
          localStorage: [
            { name: STORAGE_KEY, value: JSON.stringify(wrappedPrivateKey) },
            { name: 'e2e_public_key', value: pair.publicKeyB64 },
          ],
        },
      ];
      fs.writeFileSync(
        path.join(directory, `${role}.json`),
        JSON.stringify(state),
        { mode: 0o600 },
      );
    } finally {
      await api.dispose();
    }
  }
  fs.writeFileSync(path.join(directory, 'users.json'), JSON.stringify(users), {
    mode: 0o600,
  });
  return users;
}
