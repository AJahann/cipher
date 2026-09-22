'use client';

import {
  clearSessionKeys,
  createSessionKeys,
  restoreSessionKeys,
  STORAGE_KEY,
} from '@chat-app/shared/crypto';
import { useLogin, useRegister } from '@/lib/data-layer/user';
import { useRouter } from 'next/navigation';
import { KeyStorage } from '@/lib/keyStorage';
import { AuthForm } from '@chat-app/ui-web';

export default function AuthPage() {
  const router = useRouter();
  const loginMutation = useLogin();
  const registerMutation = useRegister();

  async function handleLogin(username: string, password: string) {
    const res = await loginMutation.mutateAsync({ username, password });
    KeyStorage.savePublicKey(res.publicKey);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(res.wrappedPrivateKey));
    await restoreSessionKeys(password);
    router.push('/chat');
  }

  async function handleRegister(username: string, password: string) {
    try {
      const pair = await createSessionKeys(password);
      await registerMutation.mutateAsync({
        username,
        password,
        publicKey: pair.publicKeyB64,
        wrappedPrivateKey: pair.wrappedPrivateKey,
      });
      KeyStorage.savePublicKey(pair.publicKeyB64);
      router.push('/chat');
    } catch (err) {
      clearSessionKeys();
      throw err;
    }
  }

  return <AuthForm onLogin={handleLogin} onRegister={handleRegister} />;
}
