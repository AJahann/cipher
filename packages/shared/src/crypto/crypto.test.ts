import { E2EEncryption } from './e2e';
import { KeyManager, unwrapPrivateKey, wrapPrivateKey } from './keys';

async function tamperBase64(value: string): Promise<string> {
  const bytes = await KeyManager.fromBase64(value);
  const tampered = Uint8Array.from(bytes);
  tampered[0] = (tampered[0] ?? 0) ^ 1;
  return KeyManager.toBase64(tampered);
}

describe(KeyManager, () => {
  it('round-trips arbitrary bytes through base64', async () => {
    const input = Uint8Array.from([0, 1, 2, 127, 128, 254, 255]);
    const encoded = await KeyManager.toBase64(input);
    const decoded = await KeyManager.fromBase64(encoded);
    expect(decoded).toEqual(input);
  });

  it('round-trips an empty byte array through base64', async () => {
    const encoded = await KeyManager.toBase64(new Uint8Array());
    const decoded = await KeyManager.fromBase64(encoded);
    expect(decoded).toEqual(new Uint8Array());
  });
});

describe('private-key wrapping', () => {
  it('unwraps a private key with the same password', async () => {
    const { privateKey } = await E2EEncryption.generateKeyPair();
    const wrapped = await wrapPrivateKey(privateKey, 'correct horse battery staple');

    await expect(
      unwrapPrivateKey(wrapped, 'correct horse battery staple'),
    ).resolves.toEqual(privateKey);
  });

  it('rejects an incorrect password', async () => {
    const { privateKey } = await E2EEncryption.generateKeyPair();
    const wrapped = await wrapPrivateKey(privateKey, 'correct password');

    await expect(unwrapPrivateKey(wrapped, 'wrong password')).rejects.toThrow(
      /secret key/i,
    );
  });

  it('uses fresh salt and nonce values for every wrap', async () => {
    const { privateKey } = await E2EEncryption.generateKeyPair();
    const first = await wrapPrivateKey(privateKey, 'same password');
    const second = await wrapPrivateKey(privateKey, 'same password');

    expect(first.salt).not.toBe(second.salt);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('rejects tampered wrapped-key ciphertext', async () => {
    const { privateKey } = await E2EEncryption.generateKeyPair();
    const wrapped = await wrapPrivateKey(privateKey, 'correct password');

    await expect(
      unwrapPrivateKey(
        { ...wrapped, ciphertext: await tamperBase64(wrapped.ciphertext) },
        'correct password',
      ),
    ).rejects.toThrow(/secret key/i);
  });
});

describe(E2EEncryption, () => {
  it('returns base64 representations of the generated key pair', async () => {
    const pair = await E2EEncryption.generateKeyPair();

    await expect(KeyManager.fromBase64(pair.publicKeyB64)).resolves.toEqual(
      pair.publicKey,
    );
    await expect(KeyManager.fromBase64(pair.privateKeyB64)).resolves.toEqual(
      pair.privateKey,
    );
  });

  it('encrypts and decrypts a message between two key pairs', async () => {
    const alice = await E2EEncryption.generateKeyPair();
    const bob = await E2EEncryption.generateKeyPair();
    const encrypted = await E2EEncryption.encryptMessage(
      'hello bob',
      bob.publicKey,
      alice.privateKey,
    );

    await expect(
      E2EEncryption.decryptMessage(
        encrypted.ciphertext,
        encrypted.nonce,
        alice.publicKey,
        bob.privateKey,
      ),
    ).resolves.toBe('hello bob');
  });

  it('round-trips Unicode text', async () => {
    const alice = await E2EEncryption.generateKeyPair();
    const bob = await E2EEncryption.generateKeyPair();
    const message = 'سلام 👋 — encrypted café';
    const encrypted = await E2EEncryption.encryptMessage(
      message,
      bob.publicKey,
      alice.privateKey,
    );

    await expect(
      E2EEncryption.decryptMessage(
        encrypted.ciphertext,
        encrypted.nonce,
        alice.publicKey,
        bob.privateKey,
      ),
    ).resolves.toBe(message);
  });

  it('round-trips an empty message', async () => {
    const alice = await E2EEncryption.generateKeyPair();
    const bob = await E2EEncryption.generateKeyPair();
    const encrypted = await E2EEncryption.encryptMessage(
      '',
      bob.publicKey,
      alice.privateKey,
    );

    await expect(
      E2EEncryption.decryptMessage(
        encrypted.ciphertext,
        encrypted.nonce,
        alice.publicKey,
        bob.privateKey,
      ),
    ).resolves.toBe('');
  });

  it('rejects decryption with the wrong recipient private key', async () => {
    const alice = await E2EEncryption.generateKeyPair();
    const bob = await E2EEncryption.generateKeyPair();
    const eve = await E2EEncryption.generateKeyPair();
    const encrypted = await E2EEncryption.encryptMessage(
      'for bob only',
      bob.publicKey,
      alice.privateKey,
    );

    await expect(
      E2EEncryption.decryptMessage(
        encrypted.ciphertext,
        encrypted.nonce,
        alice.publicKey,
        eve.privateKey,
      ),
    ).rejects.toThrow(/key pair/i);
  });

  it('rejects tampered message ciphertext', async () => {
    const alice = await E2EEncryption.generateKeyPair();
    const bob = await E2EEncryption.generateKeyPair();
    const encrypted = await E2EEncryption.encryptMessage(
      'authenticated message',
      bob.publicKey,
      alice.privateKey,
    );

    await expect(
      E2EEncryption.decryptMessage(
        await tamperBase64(encrypted.ciphertext),
        encrypted.nonce,
        alice.publicKey,
        bob.privateKey,
      ),
    ).rejects.toThrow(/key pair/i);
  });
});
