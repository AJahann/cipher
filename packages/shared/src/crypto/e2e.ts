// oxlint-disable typescript/no-extraneous-class import/no-named-as-default-member
'use client';

import _sodium from 'libsodium-wrappers-sumo';
import {
  wrapPrivateKey,
  unwrapPrivateKey,
  type WrappedPrivateKey,
} from './keys';

async function getSodium() {
  await _sodium.ready;
  return _sodium;
}

export const STORAGE_KEY = 'e2ee:wrappedPrivateKey';

let _sessionPrivateKey: Uint8Array | null = null;

export function hasSessionPrivateKey(): boolean {
  return _sessionPrivateKey !== null;
}

export function getSessionPrivateKey(): Uint8Array {
  if (!_sessionPrivateKey) throw new Error('SESSION_KEY_NOT_LOADED');
  return _sessionPrivateKey;
}

export class E2EEncryption {
  static async ready() {
    await _sodium.ready;
    return _sodium;
  }

  static async generateKeyPair() {
    const sodium = await this.ready();
    const keypair = sodium.crypto_box_keypair();

    return {
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      publicKeyB64: sodium.to_base64(keypair.publicKey),
      privateKeyB64: sodium.to_base64(keypair.privateKey),
    };
  }

  static async encryptMessage(
    message: string,
    recipientPublicKey: Uint8Array,
    senderPrivateKey: Uint8Array,
  ) {
    const sodium = await this.ready();

    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const plaintext = new TextEncoder().encode(message);

    const ciphertext = sodium.crypto_box_easy(
      plaintext,
      nonce,
      recipientPublicKey,
      senderPrivateKey,
    );

    return {
      ciphertext: sodium.to_base64(ciphertext),
      nonce: sodium.to_base64(nonce),
      algorithm: 'x25519-xsalsa20-poly1305' as const,
    };
  }

  static async decryptMessage(
    ciphertextB64: string,
    nonceB64: string,
    senderPublicKey: Uint8Array,
    recipientPrivateKey: Uint8Array,
  ) {
    const sodium = await this.ready();

    const ciphertext = sodium.from_base64(ciphertextB64);
    const nonce = sodium.from_base64(nonceB64);

    const decrypted = sodium.crypto_box_open_easy(
      ciphertext,
      nonce,
      senderPublicKey,
      recipientPrivateKey,
    );

    return new TextDecoder().decode(decrypted);
  }
}

export async function createSessionKeys(password: string) {
  const pairKeys = await E2EEncryption.generateKeyPair();
  const wrapped = await wrapPrivateKey(pairKeys.privateKey, password);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(wrapped));
  _sessionPrivateKey = pairKeys.privateKey;

  return {
    publicKeyB64: pairKeys.publicKeyB64,
    wrappedPrivateKey: wrapped,
  };
}

export async function restoreSessionKeys(password: string): Promise<void> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error('NO_WRAPPED_KEY');

  const wrapped: WrappedPrivateKey = JSON.parse(raw);
  const privateKey = await unwrapPrivateKey(wrapped, password);

  _sessionPrivateKey = privateKey;
}

export function clearSessionKeys(): void {
  _sessionPrivateKey = null;
  localStorage.removeItem(STORAGE_KEY);
}
