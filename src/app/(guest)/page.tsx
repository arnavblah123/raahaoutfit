import Link from 'next/link';
import { SignIn, SignedInAs } from '@/components/SignIn';
import { sql } from '@/lib/db';
import { googleEnabled } from '@/lib/google';
import { otpEnabled } from '@/lib/otp';
import { maskPhone } from '@/lib/phone';
import { getIdentity, signInEnabled } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Landing({ searchParams }: { searchParams: Promise<{ recovery?: string; signin?: string }> }) {
  const { recovery, signin } = await searchParams;
  const id = await getIdentity();
  const mine = id ? await sql<{ join_code: string; couple_names: string; city: string; role: string }>(
    `select w.join_code, w.couple_names, w.city, g.role from guests g join weddings w on w.id = g.wedding_id
     where w.purged_at is null and ((g.phone = $1 and g.phone_verified) or g.google_sub = $2) order by w.wedding_date`, [id.phone ?? null, id.sub ?? null]) : [];
  const needSignIn = signInEnabled() && !id;
  return (
    <div className="space-y-8 pt-6">
      {recovery === 'invalid' && <p className="err">That recovery link is not valid any more. Ask the host for the wedding link and join again.</p>}
      <div className="space-y-3">
        <h1 className="text-4xl font-semibold leading-tight">Nobody wants to turn up in the same outfit.</h1>
        <p className="text-lg text-muted">
          Guests add what they plan to wear to each function. Each guest is told, privately, if someone else is wearing the same or a very similar outfit.
        </p>
      </div>
      {mine.length > 0 && (
        <div className="space-y-2">
          <p className="label">Your weddings</p>
          {mine.map((w) => (
            <Link key={w.join_code} href={`/w/${w.join_code}`} className="card flex items-center justify-between">
              <span><span className="font-medium">{w.couple_names}</span><span className="block text-sm text-muted">{w.city}{w.role === 'creator' ? ' · you are the host' : ''}</span></span>
              <span className="text-muted">›</span>
            </Link>
          ))}
        </div>
      )}
      {needSignIn
        ? <SignIn next="/" phone={otpEnabled()} google={googleEnabled()} failed={signin === 'failed'} />
        : <Link href="/create" className="btn-primary w-full">Create a wedding</Link>}
      <ol className="space-y-3">
        {[
          ['Create the wedding', 'Add the couple, the date, the functions and your guest list. You get one link to share on WhatsApp.'],
          ['Guests add their outfits', signInEnabled() ? 'They sign in with their mobile number or Google. Two photos per outfit.' : 'Two photos per outfit. No account, no password.'],
          ['Each guest sees her own result', 'Same outfit, similar look, or no clash. Never who, and never the other photo.'],
        ].map(([t, d], i) => (
          <li key={t} className="card flex gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">{i + 1}</span>
            <div><p className="font-medium">{t}</p><p className="text-sm text-muted">{d}</p></div>
          </li>
        ))}
      </ol>
      <p className="text-center text-sm text-muted">Got a link from the host? Open it to join.</p>
      {id && <SignedInAs label={id.phone ? maskPhone(id.phone) : id.email || 'Google'} />}
    </div>
  );
}
