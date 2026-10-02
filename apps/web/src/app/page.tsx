import type { Metadata } from 'next';
import AuthPage from '@/components/auth-page';

export const metadata: Metadata = { title: 'Sign in · Cipher' };

const page = () => {
  return <AuthPage />;
};

export default page;
