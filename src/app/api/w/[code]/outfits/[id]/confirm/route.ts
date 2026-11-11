import { one, sql, transaction } from '@/lib/db';
import { ensureEmbeddings, ownOutfit } from '@/lib/outfits';
import { runMatch } from '@/lib/pipeline/match';
import { requireGuest } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { loadVocab } from '@/lib/vocab';
import { clean } from '@/lib/weddings';

export const maxDuration = 300;

type Incoming = { group_id: string; value_ids?: string[]; other?: string };

/** The guest confirms colour and attributes. Only then does matching run. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  const r = await requireGuest(code);
  if (r.error) return r.error;
  const outfit = await ownOutfit(r.guest, id);
  if (!outfit) return Response.json({ error: 'Not found' }, { status: 404 });
  const body = await req.json().catch(() => null);
  const incoming: Incoming[] = Array.isArray(body?.attributes) ? body.attributes : [];
  const [vocab, s] = await Promise.all([loadVocab(), getSettings()]);

  const previous = await sql('select group_id, value_id, ai_suggested, ai_confidence from outfit_attributes where outfit_id = $1', [id]);
  const rows: any[] = [];
  let garmentTypeId: string | null = null, colourFamilyId: string | null = null;
  for (const g of vocab.groups) {
    const inc = incoming.find((x) => x.group_id === g.id);
    if (!inc) continue;
    const ids = [...new Set((inc.value_ids ?? []).filter((v) => g.values.some((x) => x.id === v)))];
    const others = g.free_text ? [clean(inc.other, 120)].filter(Boolean)
      : clean(inc.other, 120).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 5);
    for (const text of others) {
      if (g.free_text) { rows.push({ group_id: g.id, value_id: null, other_text: text, position: 99 }); continue; }
      // "Other" entries feed the vocabulary. If the value already exists (or has just been promoted) use it.
      const resolved = (await one<{ id: string | null }>(`select record_pending_value($1, $2, 'guest', $3) as id`, [g.id, text, s.vocab_auto_promote_after]))?.id;
      if (resolved && !ids.includes(resolved)) ids.push(resolved);
      else if (!resolved) rows.push({ group_id: g.id, value_id: null, other_text: text, position: 99 });
    }
    ids.forEach((value_id, i) => {
      const was = previous.find((p) => p.group_id === g.id && p.value_id === value_id);
      rows.push({ group_id: g.id, value_id, other_text: null, position: i, ai_suggested: !!was?.ai_suggested, ai_confidence: was?.ai_confidence ?? null });
    });
    if (g.key === 'garment_type') garmentTypeId = ids[0] ?? null;
    if (g.key === 'colour') {
      const first = g.values.find((v) => v.id === ids[0]);
      colourFamilyId = first?.family_id ?? null;
    }
  }
  if (!colourFamilyId) return Response.json({ error: 'Please pick the colour of your outfit from the swatches.' }, { status: 400 });

  try {
    await ensureEmbeddings(id, body?.embeddings);
  } catch (e) {
    console.error('embedding failed', e);
    return Response.json({ error: 'We could not process your photos just now. Please try again in a minute.' }, { status: 503 });
  }
  await transaction(async (q) => {
    await q('delete from outfit_attributes where outfit_id = $1', [id]);
    for (const x of rows) {
      await q(`insert into outfit_attributes (outfit_id, group_id, value_id, other_text, ai_suggested, ai_confidence, confirmed, position)
               values ($1, $2, $3, $4, $5, $6, true, $7)`, [id, x.group_id, x.value_id, x.other_text, !!x.ai_suggested, x.ai_confidence ?? null, x.position]);
    }
    await q(`update outfits set status = 'confirmed', garment_type_id = $2, colour_family_id = $3, confirmed_at = coalesce(confirmed_at, now()) where id = $1`,
      [id, garmentTypeId, colourFamilyId]);
  });

  await runMatch(id);
  const result = await one('select verdict, reason, state from outfit_results where outfit_id = $1', [id]);
  return Response.json({ result });
}
