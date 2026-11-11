import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Outfit Clash',
  description: 'Find out privately if someone else is wearing the same outfit to the wedding.',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#8a1c3c' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-dvh antialiased">
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-10">
          <header className="flex items-center justify-between py-4">
            <Link href="/" className="font-[family-name:var(--font-display)] text-xl font-semibold text-brand">Outfit Clash</Link>
            <Link href="/privacy" className="text-sm text-muted underline-offset-4 hover:underline">Privacy</Link>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
