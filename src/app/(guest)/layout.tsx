import Link from 'next/link';

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-10">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="font-[family-name:var(--font-display)] text-xl font-semibold text-brand">Outfit Clash</Link>
        <Link href="/privacy" className="text-sm text-muted underline-offset-4 hover:underline">Privacy</Link>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
