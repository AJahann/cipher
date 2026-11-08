import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/config/query-provider';
import { TelemetryProvider } from '@/components/telemetry-provider';

export const metadata: Metadata = {
  title: 'Cipher',
  description: 'End-to-end encrypted chat',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang='en' className='h-full antialiased'>
      <body className='min-h-full flex flex-col'>
        <TelemetryProvider />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
