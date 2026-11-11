import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JoinForm } from '@/components/JoinForm';
import { LinksCard } from '@/components/LinksCard';
import { VerdictBadge } from '@/components/VerdictBadge';
import { db, guestDb } from '@/lib/db';
import { env } from '@/lib/env';
import { getGuest, getWedding } from '@/lib/session';
import { functionName } from '@/lib/weddings';

export const dynamic = 'force-dynamic';
const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

export default async function WeddingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
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
  if (!guest) {
    return (
      <div className="space-y-5">
        {header}
        <p className="text-muted">Add what you plan to wear to each function. You will be told, privately, if someone else is wearing the same or a very similar outfit.</p>
        <JoinForm code={code} />
      </div>
    );
  }

  // Everything the guest reads about herself goes through her RLS-scoped client.
  const mine = guestDb(guest);
  const [{ data: functions }, { data: outfits }, { data: requests }, map] = await Promise.all([
    db().from('functions').select('id,kind,custom_name,sort').eq('wedding_id', wedding.id).order('sort'),
    mine.from('outfits').select('id,function_id,status,created_at, outfit_photos(kind,storage_path), outfit_results(verdict,state,seen_at)').order('created_at'),
    mine.from('photo_requests').select('outfit_id,kind,requested_photo').eq('status', 'open'),
    wedding.colour_map_enabled ? db().rpc('colour_map', { p_wedding: wedding.id }) : Promise.resolve({ data: [] as any[] }),
  ]);
  const thumbs = new Map<string, string>();
  const paths = (outfits ?? []).map((o: any) => ({ id: o.id, path: (o.outfit_photos.find((p: any) => p.kind === 'full') ?? o.outfit_photos[0])?.storage_path }))
    .filter((x: any) => x.path);
  if (paths.length) {
    const { data } = await mine.storage.from('outfits').createSignedUrls(paths.map((p: any) => p.path), 600);
    data?.forEach((d, i) => { if (d.signedUrl) thumbs.set(paths[i].id, d.signedUrl); });
  }
  const result = (o: any) => (Array.isArray(o.outfit_results) ? o.outfit_results[0] : o.outfit_results);
  const fresh = (outfits ?? []).filter((o: any) => { const r = result(o); return r && !r.seen_at && r.verdict !== 'no_clash'; });

  return (
    <div className="space-y-5">
      {header}
      <p className="text-sm text-muted">Hello {guest.display_name}. Only you can see what is on this page.</p>

      {fresh.map((o: any) => (
        <Link key={o.id} href={`/w/${code}/outfit/${o.id}`} className="err block">
          <span className="font-medium">New since your last visit:</span> someone has added an outfit close to one of yours. Tap to see.
        </Link>
      ))}
      {(requests ?? []).map((r: any) => (
        <Link key={r.outfit_id} href={`/w/${code}/outfit/${r.outfit_id}`} className="note block">
          <span className="font-medium">Please add a clearer photo:</span> {r.requested_photo}. Tap to add it.
        </Link>
      ))}

      {(functions ?? []).map((f: any) => {
        const here = (outfits ?? []).filter((o: any) => o.function_id === f.id);
        const counts = ((map.data ?? []) as any[]).filter((m) => m.function_id === f.id);
        return (
          <section key={f.id} className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{functionName(f)}</h2>
              <Link href={`/w/${code}/add?function=${f.id}`} className="btn-primary btn-sm">Add outfit</Link>
            </div>
            {here.length === 0 && <p className="text-sm text-muted">You have not added an outfit for this yet.</p>}
            {here.map((o: any) => {
              const r = result(o);
              return (
                <Link key={o.id} href={o.status === 'confirmed' ? `/w/${code}/outfit/${o.id}` : `/w/${code}/add?function=${f.id}&outfit=${o.id}`}
                  className="flex items-center gap-3 rounded-xl border border-line p-2">
                  {thumbs.get(o.id)
                    ? <img src={thumbs.get(o.id)} alt="Your outfit" className="h-16 w-12 rounded-lg object-cover" />
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

      <LinksCard code={code} appUrl={env.appUrl} isCreator={guest.role === 'creator'} couple={wedding.couple_names} />
      {guest.role === 'creator' && <Link href={`/w/${code}/settings`} className="btn-ghost w-full">Wedding settings</Link>}
      <p className="text-center text-xs text-muted">Photos and details are deleted 7 days after the wedding. <Link href="/privacy" className="underline">How we protect your photos</Link></p>
    </div>
  );
}
