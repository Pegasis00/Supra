import './globals.css';
import type { Metadata, Viewport } from 'next';
import { AskSupraProvider } from '@/components/AskSupraContext';

export const metadata: Metadata = {
  title: 'Supra Billing',
  description: 'Invoices for Supra Marketing',
  appleWebApp: { capable: true, title: 'Supra Billing' },
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#111a2d' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><AskSupraProvider>{children}</AskSupraProvider></body>
    </html>
  );
}
