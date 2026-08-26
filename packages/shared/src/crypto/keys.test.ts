import { describe, it, expect } from 'vitest';
import { E2EEncryption } from './e2e';

describe('E2EEncryption round-trip', () => {
  it('decrypt(encrypt(m)) === m', async () => {
    const alice = await E2EEncryption.generateKeyPair(); // sender
    const bob = await E2EEncryption.generateKeyPair(); // recipient

    const { ciphertext, nonce } = await E2EEncryption.encryptMessage(
      'hello ashkan',
      bob.publicKey,
      alice.privateKey,
    );

    const back = await E2EEncryption.decryptMessage(
      ciphertext,
      nonce,
      alice.publicKey,
      bob.privateKey,
    );

    expect(back).toBe('hello ashkan');
  });

  it('wrong recipient key cannot decrypt', async () => {
    const alice = await E2EEncryption.generateKeyPair();
    const bob = await E2EEncryption.generateKeyPair();
    const eve = await E2EEncryption.generateKeyPair();

    const { ciphertext, nonce } = await E2EEncryption.encryptMessage(
      'secret',
      bob.publicKey,
      alice.privateKey,
    );

    await expect(
      E2EEncryption.decryptMessage(
        ciphertext,
        nonce,
        alice.publicKey,
        eve.privateKey,
      ),
    ).rejects.toThrow();
  });
});
