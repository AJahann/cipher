import { KeyManager } from '@chat-app/shared';

const PUBLIC_KEY = 'e2e_public_key';

export const KeyStorage = {
  savePublicKey(publicKeyB64: string) {
    localStorage.setItem(PUBLIC_KEY, publicKeyB64);
  },

  loadPublicKey(): string | null {
    return localStorage.getItem(PUBLIC_KEY);
  },

  clear() {
    localStorage.removeItem(PUBLIC_KEY);
  },

  loadPublicKeyRaw(): Promise<Uint8Array | null> {
    const b64 = this.loadPublicKey();
    return b64 ? KeyManager.fromBase64(b64) : Promise.resolve(null);
  },
};
