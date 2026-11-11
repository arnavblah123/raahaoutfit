import { isUuid, one, sql } from '@/lib/db';
import { AiError } from '@/lib/ai';
import { UploadError, photoUrls, readUpload, storeCropped } from '@/lib/outfits';
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
  if (!isUuid(functionId) || !(await one('select 1 from functions where id = $1 and wedding_id = $2', [functionId, wedding.id]))) {
    return Response.json({ error: 'Pick a function.' }, { status: 400 });
  }
  const count = await one<{ n: number }>('select count(*) as n from outfits where guest_id = $1 and function_id = $2', [guest.id, functionId]);
  if ((count?.n ?? 0) >= s.max_outfits_per_function) {
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

  const consent = form.get('consent') === 'yes';
  const outfit = (await one<{ id: string }>(
    `insert into outfits (wedding_id, function_id, guest_id, keep_for_training, consent_at) values ($1, $2, $3, $4, case when $4 then now() end) returning id`,
    [wedding.id, functionId, guest.id, consent]))!;
  await logUsage(read.usage, { outfit_id: outfit.id });

  const photos = await Promise.all([
    storeCropped({ outfitId: outfit.id, kind: 'full', image: full, bbox: read.photos[0]?.bbox }),
    storeCropped({ outfitId: outfit.id, kind: 'closeup', image: closeup, bbox: read.photos[1]?.bbox }),
  ]);
  for (const sg of read.suggestions) {
    for (const [i, valueId] of sg.value_ids.entries()) {
      await sql(`insert into outfit_attributes (outfit_id, group_id, value_id, ai_suggested, ai_confidence, position) values ($1, $2, $3, true, $4, $5)`,
        [outfit.id, sg.group_id, valueId, sg.confidence, i]);
    }
    if (sg.other) {
      await sql(`insert into outfit_attributes (outfit_id, group_id, other_text, ai_suggested, ai_confidence, position) values ($1, $2, $3, true, $4, 99)`,
        [outfit.id, sg.group_id, sg.other, sg.confidence]);
    }
  }
  for (const p of read.proposals) await sql(`select record_pending_value($1, $2, 'ai', $3)`, [p.group_id, p.value, s.vocab_auto_promote_after]);
  return Response.json({ outfitId: outfit.id, photos: photoUrls(wedding.join_code, photos), suggestions: read.suggestions });
}
