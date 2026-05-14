'use client';

import { AuthGuard } from '../_components/auth-guard';
import { SessionGate } from '../_components/session-gate';

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <SessionGate>{children}</SessionGate>
    </AuthGuard>
  );
}
