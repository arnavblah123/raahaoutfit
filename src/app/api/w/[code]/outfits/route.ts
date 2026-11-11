import { db, must } from '@/lib/db';
import { AiError } from '@/lib/ai';
import { UploadError, readUpload, signPhotos, storeCropped } from '@/lib/outfits';
import { runRead } from '@/lib/pipeline/read';
import { checkRate } from '@/lib/ratelimit';
import { requireGuest } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { logUsage } from '@/lib/usage';

export const maxDuration = 120;

/** Upload two photos, run Step 1 (Read), store only the cropped images. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const r = await requireGuest((await params).code);
  if (r.error) return r.error;
  const { guest, wedding } = r;
  const s = await getSettings();
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: 'Upload failed. Please try again.' }, { status: 400 });

  const functionId = String(form.get('function_id') ?? '');
  const fn = must(await db().from('functions').select('id').eq('id', functionId).eq('wedding_id', wedding.id).maybeSingle());
  if (!fn) return Response.json({ error: 'Pick a function.' }, { status: 400 });
  const { count } = await db().from('outfits').select('id', { count: 'exact', head: true })
    .eq('guest_id', guest.id).eq('function_id', functionId);
  if ((count ?? 0) >= s.max_outfits_per_function) {
    return Response.json({ error: `You can add up to ${s.max_outfits_per_function} outfits per function. Delete one to add another.` }, { status: 409 });
  }

  let full, closeup;
  try {
    [full, closeup] = await Promise.all([readUpload(form.get('full')), readUpload(form.get('closeup'))]);
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const limited = await checkRate('upload', guest.id, wedding.id, s.uploads_per_guest_per_day, s.uploads_per_wedding_per_day);
  if (limited) return Response.json({ error: limited }, { status: 429 });

  let read;
  try {
    read = await runRead([full.jpeg, closeup.jpeg]);
  } catch (e: any) {
    await logUsage(e?.usage, {});
    if (e instanceof AiError) return Response.json({ error: 'We could not read those photos just now. Please try again.' }, { status: 503 });
    throw e;
  }
  if (read.notOutfit) {
    await logUsage(read.usage, {});
    return Response.json({ error: 'That does not look like an outfit. Please upload a photo of what you plan to wear.' }, { status: 422 });
  }

  const outfit = must(await db().from('outfits').insert({
    wedding_id: wedding.id, function_id: functionId, guest_id: guest.id,
    keep_for_training: form.get('consent') === 'yes', consent_at: form.get('consent') === 'yes' ? new Date().toISOString() : null,
  }).select('id').single(), 'create outfit') as any;
  await logUsage(read.usage, { outfit_id: outfit.id });

  const photos = await Promise.all([
    storeCropped({ guest, outfitId: outfit.id, kind: 'full', image: full, bbox: read.photos[0]?.bbox }),
    storeCropped({ guest, outfitId: outfit.id, kind: 'closeup', image: closeup, bbox: read.photos[1]?.bbox }),
  ]);
  const rows = read.suggestions.flatMap((sg) => [
    ...sg.value_ids.map((value_id, i) => ({ value_id, other_text: null as string | null, position: i })),
    ...(sg.other ? [{ value_id: null as string | null, other_text: sg.other, position: 99 }] : []),
  ].map((x) => ({ ...x, outfit_id: outfit.id, group_id: sg.group_id, ai_suggested: true, ai_confidence: sg.confidence, confirmed: false })));
  if (rows.length) must(await db().from('outfit_attributes').insert(rows), 'save suggestions');
  for (const p of read.proposals) {
    await db().rpc('record_pending_value', { p_group: p.group_id, p_raw: p.value, p_by: 'ai', p_promote_after: s.vocab_auto_promote_after });
  }
  return Response.json({ outfitId: outfit.id, photos: await signPhotos(guest, photos), suggestions: read.suggestions });
}
