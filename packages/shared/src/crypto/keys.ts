// oxlint-disable typescript/no-extraneous-class
import _sodium from 'libsodium-wrappers-sumo';

async function getSodium() {
  // oxlint-disable-next-line import/no-named-as-default-member
  await _sodium.ready;
  return _sodium;
}

export class KeyManager {
  static async toBase64(key: Uint8Array): Promise<string> {
    const sodium = await getSodium();
    return sodium.to_base64(key);
  }

  static async fromBase64(b64: string): Promise<Uint8Array> {
    const sodium = await getSodium();
    return sodium.from_base64(b64);
  }
}

export interface WrappedPrivateKey {
  ciphertext: string;
  salt: string;
  nonce: string;
}

async function deriveWrappingKey(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const sodium = await getSodium();

  return sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    password,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

export async function wrapPrivateKey(
  privateKey: Uint8Array,
  password: string,
): Promise<WrappedPrivateKey> {
  const sodium = await getSodium();

  const salt = sodium.randombytes_buf(16);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const wrappingKey = await deriveWrappingKey(password, salt);

  const ciphertext = sodium.crypto_secretbox_easy(
    privateKey,
    nonce,
    wrappingKey,
  );

  return {
    ciphertext: sodium.to_base64(ciphertext),
    salt: sodium.to_base64(salt),
    nonce: sodium.to_base64(nonce),
  };
}

export async function unwrapPrivateKey(
  wrapped: WrappedPrivateKey,
  password: string,
): Promise<Uint8Array> {
  const sodium = await getSodium();

  const salt = sodium.from_base64(wrapped.salt);
  const nonce = sodium.from_base64(wrapped.nonce);
  const ciphertext = sodium.from_base64(wrapped.ciphertext);

  const wrappingKey = await deriveWrappingKey(password, salt);

  return sodium.crypto_secretbox_open_easy(ciphertext, nonce, wrappingKey);
}
