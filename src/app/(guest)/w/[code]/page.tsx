import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JoinForm } from '@/components/JoinForm';
import { LinksCard } from '@/components/LinksCard';
import { VerdictBadge } from '@/components/VerdictBadge';
import { asGuest, sql } from '@/lib/db';
import { env } from '@/lib/env';
import { SignIn, SignedInAs } from '@/components/SignIn';
import { one } from '@/lib/db';
import { googleEnabled } from '@/lib/google';
import { otpEnabled } from '@/lib/otp';
import { maskPhone } from '@/lib/phone';
import { getGuest, getIdentity, getWedding, signInEnabled } from '@/lib/session';
import { functionName } from '@/lib/weddings';

export const dynamic = 'force-dynamic';
const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

export default async function WeddingPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ signin?: string }> }) {
  const { code } = await params;
  const { signin } = await searchParams;
  const wedding = await getWedding(code);
  if (!wedding) notFound();
  const header = (
    <div className="pt-2">
      <p className="text-sm text-muted">{wedding.city} · {fmt(wedding.wedding_date)}</p>
      <h1 className="text-3xl font-semibold">{wedding.couple_names}</h1>
    </div>
  );
  if (wedding.purged_at) {
    return <div className="space-y-4">{header}<p className="note">This wedding has ended. All photos, names and outfit details have been deleted.</p></div>;
  }
  const guest = await getGuest(wedding);
  const id = await getIdentity();
  const signedIn = id && <SignedInAs label={id.phone ? maskPhone(id.phone) : id.email || 'Google'} />;
  if (!guest) {
    const intro = <p className="text-muted">Add what you plan to wear to each function. You will be told, privately, if someone else is wearing the same or a very similar outfit.</p>;
    if (!signInEnabled()) {
      return (
        <div className="space-y-5">
          {header}{intro}
          {wedding.require_approval && <p className="note">The host approves each guest. After you join, you will be let in once they say yes.</p>}
          <JoinForm code={code} plain />
        </div>
      );
    }
    if (!id) {
      return (
        <div className="space-y-5">
          {header}{intro}
          <SignIn next={`/w/${code}`} phone={otpEnabled()} google={googleEnabled()} failed={signin === 'failed'} />
          <p className="text-center text-sm text-muted">Use the mobile number the host has for you.</p>
        </div>
      );
    }
    // Signed in, not in this wedding yet. With a proved number we already know whether it is on the guest list.
    const listed = id.phone ? await one<{ name: string | null }>('select name from guest_list where wedding_id = $1 and phone = $2', [wedding.id, id.phone]) : null;
    const asking = !!id.phone && !listed && wedding.require_approval;
    return (
      <div className="space-y-5">
        {header}
        {listed && <p className="note"><span className="font-medium">You are on the guest list.</span> One last thing before you add your outfits.</p>}
        {asking && <p className="note"><span className="font-medium">Your number is not on the guest list.</span> You can ask the host to let you in. They will see your name and number.</p>}
        {!id.phone && wedding.require_approval && <p className="note">If your number is on the host&apos;s guest list you get straight in. If not, the host is asked to let you in.</p>}
        <JoinForm code={code} name={id.name ?? ''} askPhone={!id.phone} asking={asking} />
        {signedIn}
      </div>
    );
  }
  if (guest.status !== 'approved') {
    return (
      <div className="space-y-5">
        {header}
        {guest.status === 'pending'
          ? <p className="note"><span className="font-medium">Waiting for the host.</span> Hello {guest.display_name}. The host has been asked to let you in. Open this link again in a little while.</p>
          : <p className="err">The host has not approved this request to join.</p>}
        {guest.status === 'pending' && !guest.phone && !guest.google_linked && <LinksCard code={code} appUrl={env.appUrl} isCreator={false} couple={wedding.couple_names} />}
        {signedIn}
      </div>
    );
  }
  const waiting = guest.role === 'creator'
    ? (await sql<{ n: number }>(`select count(*) as n from guests where wedding_id = $1 and status = 'pending'`, [wedding.id]))[0].n : 0;

  // Everything the guest reads about herself runs as the restricted role (row-level security).
  const { functions, outfits, requests } = await asGuest(guest, async (q) => ({
    functions: await q('select id, kind, custom_name from functions order by sort'),
    outfits: await q(
      `select o.id, o.function_id, o.status, r.verdict, r.state, r.seen_at,
              (select p.id from outfit_photos p where p.outfit_id = o.id order by (p.kind = 'full') desc, p.created_at limit 1) as photo_id
       from outfits o left join outfit_results r on r.outfit_id = o.id order by o.created_at`),
    requests: await q(`select outfit_id, kind, requested_photo from photo_requests where status = 'open'`),
  }));
  const map = wedding.colour_map_enabled ? await sql('select * from colour_map($1)', [wedding.id]) : [];
  const fresh = outfits.filter((o) => o.verdict && !o.seen_at && o.verdict !== 'no_clash');

  return (
    <div className="space-y-5">
      {header}
      <p className="text-sm text-muted">Hello {guest.display_name}. Only you can see what is on this page.</p>
      {waiting > 0 && (
        <Link href={`/w/${code}/settings`} className="note block"><span className="font-medium">{waiting} {waiting === 1 ? 'guest is' : 'guests are'} waiting for your approval.</span> Tap to let them in.</Link>
      )}

      {fresh.map((o) => (
        <Link key={o.id} href={`/w/${code}/outfit/${o.id}`} className="err block">
          <span className="font-medium">New since your last visit:</span> someone has added an outfit close to one of yours. Tap to see.
        </Link>
      ))}
      {requests.map((r) => (
        <Link key={r.outfit_id} href={`/w/${code}/outfit/${r.outfit_id}`} className="note block">
          <span className="font-medium">Please add a clearer photo:</span> {r.requested_photo}. Tap to add it.
        </Link>
      ))}

      {functions.map((f) => {
        const here = outfits.filter((o) => o.function_id === f.id);
        const counts = map.filter((m) => m.function_id === f.id);
        return (
          <section key={f.id} className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{functionName(f)}</h2>
              <Link href={`/w/${code}/add?function=${f.id}`} className="btn-primary btn-sm">Add outfit</Link>
            </div>
            {here.length === 0 && <p className="text-sm text-muted">You have not added an outfit for this yet.</p>}
            {here.map((o) => {
              const r = o.verdict ? o : null;
              return (
                <Link key={o.id} href={o.status === 'confirmed' ? `/w/${code}/outfit/${o.id}` : `/w/${code}/add?function=${f.id}&outfit=${o.id}`}
                  className="flex items-center gap-3 rounded-xl border border-line p-2">
                  {o.photo_id
                    ? <img src={`/api/w/${code}/photos/${o.photo_id}`} alt="Your outfit" className="h-16 w-12 rounded-lg object-cover" />
                    : <span className="h-16 w-12 rounded-lg bg-line" />}
                  <span className="flex-1">
                    {o.status !== 'confirmed' ? <span className="text-sm font-medium text-warn">Not finished: confirm the details</span>
                      : r ? <VerdictBadge verdict={r.verdict} /> : <span className="text-sm text-muted">Checking…</span>}
                    {r?.state === 'needs_photo' && <span className="mt-1 block text-xs text-muted">One more photo needed</span>}
                  </span>
                  <span className="text-muted">›</span>
                </Link>
              );
            })}
            {wedding.colour_map_enabled && (
              <div className="border-t border-line pt-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Colours so far</p>
                {counts.length === 0 ? <p className="text-sm text-muted">No outfits yet.</p> : (
                  <div className="flex flex-wrap gap-2">
                    {counts.map((c) => <span key={c.family_key} className="rounded-full bg-[#f4ebe1] px-3 py-1 text-sm">{c.family_label}: {c.outfits}</span>)}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}

      <LinksCard code={code} appUrl={env.appUrl} isCreator={guest.role === 'creator'} couple={wedding.couple_names} personal={!guest.phone && !guest.google_linked} />
      {guest.role === 'creator' && <Link href={`/w/${code}/settings`} className="btn-ghost w-full">{signInEnabled() ? 'Guest list and settings' : 'Wedding settings'}</Link>}
      <p className="text-center text-xs text-muted">Photos and details are deleted 7 days after the wedding. <Link href="/privacy" className="underline">How we protect your photos</Link></p>
      {signedIn}
    </div>
  );
}
