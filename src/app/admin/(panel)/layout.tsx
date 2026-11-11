import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin';
import { signOut } from '../actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const NAV = [
  ['/admin', 'Dashboard'], ['/admin/reference', 'Review'], ['/admin/label', 'Label'], ['/admin/vocabulary', 'Vocabulary'],
  ['/admin/feedback', 'Feedback'], ['/admin/imports', 'Imports'], ['/admin/brands', 'Brands'], ['/admin/stock', 'My stock'], ['/admin/settings', 'Settings'],
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect('/admin/login');
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-2 py-4">
        <Link href="/admin" className="font-[family-name:var(--font-display)] text-xl font-semibold text-brand">Outfit Clash admin</Link>
        <form action={async () => { 'use server'; await signOut(); redirect('/admin/login'); }}>
          <button className="text-sm text-muted underline">Sign out</button>
        </form>
      </header>
      <nav className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-line px-4 pb-2">
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} className="shrink-0 rounded-full px-3 py-1.5 text-sm hover:bg-white">{label}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
