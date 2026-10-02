import type { Metadata } from 'next';
import ChatLayout from '@/components/chat-layout';

export const metadata: Metadata = { title: 'Conversations · Cipher' };

export default function ChatPage() {
  return <ChatLayout />;
}
