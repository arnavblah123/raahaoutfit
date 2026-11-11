import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { OutfitActions } from '@/components/OutfitActions';
import { VerdictBadge } from '@/components/VerdictBadge';
import { asGuest, sql } from '@/lib/db';
import { ownOutfit, photoUrls } from '@/lib/outfits';
import { getGuest, getWedding } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { loadVocab, summarise } from '@/lib/vocab';
import { functionName } from '@/lib/weddings';

export const dynamic = 'force-dynamic';

export default async function OutfitPage({ params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  const wedding = await getWedding(code);
  if (!wedding || wedding.purged_at) notFound();
  const guest = await getGuest(wedding);
  if (!guest) redirect(`/w/${code}`);
  const outfit = await ownOutfit(guest, id);
  if (!outfit) notFound();
  if (outfit.status !== 'confirmed') redirect(`/w/${code}/add?function=${outfit.function_id}&outfit=${id}`);

  const [{ photos, attrs, result, requests, fn }, vocab, s] = await Promise.all([
    asGuest(guest, async (q) => ({
      photos: await q<{ id: string; kind: string }>('select id, kind from outfit_photos where outfit_id = $1 order by created_at', [id]),
      attrs: await q('select group_id, value_id, other_text from outfit_attributes where outfit_id = $1 order by position', [id]),
      result: (await q('select verdict, reason, state, seen_at from outfit_results where outfit_id = $1', [id]))[0] ?? null,
      requests: await q(`select kind, requested_photo from photo_requests where outfit_id = $1 and status = 'open'`, [id]),
      fn: (await q('select kind, custom_name from functions where id = $1', [outfit.function_id]))[0] ?? null,
    })),
    loadVocab(), getSettings(),
  ]);
  const signed = photoUrls(code, photos);

  const clash = !!result && result.verdict !== 'no_clash';
  const similar = clash ? await sql('select * from similar_styles($1, $2, $3)', [id, s.similar_styles_count, s.judge_threshold]) : [];
  const request = requests[0];
  const details = summarise(vocab, attrs);

  return (
    <div className="space-y-5 pt-2">
      <Link href={`/w/${code}`} className="text-sm text-muted">‹ Back</Link>
      <div>
        <p className="text-sm text-muted">{fn ? functionName(fn) : ''}</p>
        <h1 className="text-3xl font-semibold">Your result</h1>
      </div>

      <section className="card space-y-2">
        {result ? (
          <>
            <VerdictBadge verdict={result.verdict} large />
            <p>{result.reason}</p>
            <p className="text-xs text-muted">Only you can see this. We never show who the other guest is, or her photo. If someone adds a similar outfit later, you will see it here the next time you open your link.</p>
          </>
        ) : <p className="text-muted">Your result is not ready yet. Check back in a minute.</p>}
      </section>

      <OutfitActions code={code} outfitId={id} hasResult={!!result} unseen={!!result && !result.seen_at} verdict={result?.verdict ?? null}
        request={request ? { text: request.requested_photo, followup: request.kind === 'followup' } : null} />

      {clash && similar.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold">See similar styles</h2>
            <p className="text-sm text-muted">Close to your look, and not a clash with anyone at this function.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {similar.map((p) => (
              <a key={p.id} href={p.permalink} target="_blank" rel="noopener" className="card space-y-2 p-2">
                {p.image_url && <img src={p.image_url} alt={p.name ?? 'Outfit'} className="aspect-[3/4] w-full rounded-xl object-cover" loading="lazy" />}
                <p className="line-clamp-2 text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted">{p.brand ?? 'Raaha by Archana Bansal'}{p.price ? ` · ${p.currency === 'INR' || !p.currency ? '₹' : p.currency + ' '}${Number(p.price).toLocaleString('en-IN')}` : ''}</p>
              </a>
            ))}
          </div>
          <p className="text-xs text-muted">Links open the brand's own website.</p>
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="text-xl font-semibold">Your outfit</h2>
        <div className="flex gap-2 overflow-x-auto">
          {signed.map((p) => <img key={p.id} src={p.url} alt="Your outfit" className="h-40 w-28 shrink-0 rounded-xl object-cover" />)}
        </div>
        <dl className="space-y-1 text-sm">
          {Object.entries(details).map(([k, v]) => (
            <div key={k} className="flex gap-2"><dt className="w-36 shrink-0 text-muted">{k}</dt><dd className="capitalize">{v.join(', ')}</dd></div>
          ))}
        </dl>
        <Link href={`/w/${code}/add?function=${outfit.function_id}&outfit=${id}`} className="btn-ghost btn-sm">Edit details</Link>
      </section>
    </div>
  );
}
