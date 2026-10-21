/* oxlint-disable no-await-in-loop -- Mutation cases run sequentially to avoid parallel KDF memory use. */
import { describe, expect, it } from 'vitest';
import { E2EEncryption } from './e2e';
import {
  CHAT_ALGORITHM_V1,
  decryptChatMessage,
  encryptChatMessage,
} from './envelope';
import { unwrapPrivateKey, wrapPrivateKey } from './keys';

const randomUUID = () => crypto.randomUUID();

const context = {
  senderId: randomUUID(),
  recipientId: randomUUID(),
  conversationId: randomUUID(),
  clientMessageId: randomUUID(),
};
describe('authenticated application context', () => {
  it('decrypts on both participating devices and binds every routing field', async () => {
    const a = await E2EEncryption.generateKeyPair();
    const b = await E2EEncryption.generateKeyPair();
    const encrypted = await encryptChatMessage(
      'hello',
      b.publicKey,
      a.privateKey,
      context,
    );
    expect(encrypted.algorithm).toBe(CHAT_ALGORITHM_V1);
    await expect(
      decryptChatMessage(encrypted, a.publicKey, b.privateKey, context),
    ).resolves.toBe('hello');
    await expect(
      decryptChatMessage(encrypted, b.publicKey, a.privateKey, context),
    ).resolves.toBe('hello');
    for (const key of [
      'senderId',
      'recipientId',
      'conversationId',
      'clientMessageId',
    ] as const) {
      await expect(
        decryptChatMessage(encrypted, a.publicKey, b.privateKey, {
          ...context,
          [key]: randomUUID(),
        }),
      ).rejects.toThrow('MESSAGE_CONTEXT_MISMATCH');
    }
  });
  it('rejects reflection, unsupported algorithms and version downgrade', async () => {
    const a = await E2EEncryption.generateKeyPair();
    const b = await E2EEncryption.generateKeyPair();
    const encrypted = await encryptChatMessage(
      'hello',
      b.publicKey,
      a.privateKey,
      context,
    );
    await expect(
      decryptChatMessage(encrypted, b.publicKey, a.privateKey, {
        ...context,
        senderId: context.recipientId,
        recipientId: context.senderId,
      }),
    ).rejects.toThrow('MESSAGE_CONTEXT_MISMATCH');
    await expect(
      decryptChatMessage(
        { ...encrypted, algorithm: 'x25519-xsalsa20-poly1305' },
        a.publicKey,
        b.privateKey,
        context,
      ),
    ).rejects.toThrow('MESSAGE_VERSION_DOWNGRADE');
    await expect(
      decryptChatMessage(
        { ...encrypted, algorithm: 'unknown' },
        a.publicKey,
        b.privateKey,
        context,
      ),
    ).rejects.toThrow('UNSUPPORTED_MESSAGE_ALGORITHM');
  });
  it('reads explicit legacy history without claiming context authentication', async () => {
    const a = await E2EEncryption.generateKeyPair();
    const b = await E2EEncryption.generateKeyPair();
    const encrypted = await E2EEncryption.encryptMessage(
      'legacy',
      b.publicKey,
      a.privateKey,
    );
    await expect(
      decryptChatMessage(encrypted, a.publicKey, b.privateKey, context),
    ).resolves.toBe('legacy');
  });
});
describe('versioned and bounded key bundles', () => {
  it('roundtrips new bundles and preserves legacy versionless recovery', async () => {
    const a = await E2EEncryption.generateKeyPair();
    const bundle = await wrapPrivateKey(a.privateKey, 'password');
    expect(bundle).toMatchObject({
      version: 1,
      kdf: 'argon2id13',
      opslimit: 2,
      memlimit: 67_108_864,
    });
    await expect(unwrapPrivateKey(bundle, 'password')).resolves.toEqual(
      a.privateKey,
    );
    const legacy = {
      ciphertext: bundle.ciphertext,
      salt: bundle.salt,
      nonce: bundle.nonce,
    };
    await expect(unwrapPrivateKey(legacy, 'password')).resolves.toEqual(
      a.privateKey,
    );
  });
  it('rejects unknown, incomplete and unbounded KDF metadata before deriving', async () => {
    const a = await E2EEncryption.generateKeyPair();
    const bundle = await wrapPrivateKey(a.privateKey, 'password');
    for (const bad of [
      { ...bundle, version: 2 },
      { ...bundle, memlimit: 2 ** 32 },
      { ...bundle, kdf: undefined },
    ]) {
      await expect(unwrapPrivateKey(bad as any, 'password')).rejects.toThrow(
        /Invalid|Incomplete/i,
      );
    }
  });
});
