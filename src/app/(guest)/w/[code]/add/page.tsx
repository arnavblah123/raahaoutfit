import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AddOutfit, type Selection } from '@/components/AddOutfit';
import { asGuest, sql } from '@/lib/db';
import { ownOutfit, photoUrls } from '@/lib/outfits';
import { getGuest, getWedding } from '@/lib/session';
import { loadVocab } from '@/lib/vocab';
import { functionName } from '@/lib/weddings';

export const dynamic = 'force-dynamic';

export default async function AddPage({ params, searchParams }: {
  params: Promise<{ code: string }>; searchParams: Promise<{ function?: string; outfit?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const wedding = await getWedding(code);
  if (!wedding || wedding.purged_at) notFound();
  const guest = await getGuest(wedding);
  if (!guest || guest.status !== 'approved') redirect(`/w/${code}`);
  const [vocab, functions] = await Promise.all([
    loadVocab(),
    sql('select id, kind, custom_name from functions where wedding_id = $1 order by sort', [wedding.id]),
  ]);

  // Resuming an unfinished outfit, or editing a confirmed one.
  let existing: { id: string; functionId: string; photos: { id: string; kind: string; url: string }[]; selection: Selection; suggested: Record<string, string[]>; confirmed: boolean } | undefined;
  if (sp.outfit) {
    const outfit = await ownOutfit(guest, sp.outfit);
    if (!outfit) notFound();
    const { photos, attrs } = await asGuest(guest, async (q) => ({
      photos: await q<{ id: string; kind: string }>('select id, kind from outfit_photos where outfit_id = $1 order by created_at', [outfit.id]),
      attrs: await q('select group_id, value_id, other_text, ai_suggested from outfit_attributes where outfit_id = $1 order by position', [outfit.id]),
    }));
    const selection: Selection = {}; const suggested: Record<string, string[]> = {};
    const colourGroup = vocab.groups.find((g) => g.key === 'colour')!.id;
    for (const a of attrs) {
      const s = (selection[a.group_id] ??= { ids: [], other: '' });
      if (a.value_id) {
        if (a.ai_suggested) (suggested[a.group_id] ??= []).push(a.value_id);
        // Colour is never pre-selected from the AI: the guest has to pick it herself.
        if (outfit.status === 'confirmed' || a.group_id !== colourGroup) s.ids.push(a.value_id);
      } else if (a.other_text) s.other = s.other ? `${s.other}, ${a.other_text}` : a.other_text;
    }
    existing = {
      id: outfit.id, functionId: outfit.function_id, selection, suggested, confirmed: outfit.status === 'confirmed',
      photos: photoUrls(code, photos),
    };
  }

  return (
    <div className="space-y-4 pt-2">
      <Link href={`/w/${code}`} className="text-sm text-muted">‹ Back</Link>
      <AddOutfit
        code={code}
        functions={functions.map((f) => ({ id: f.id, name: functionName(f) }))}
        initialFunction={existing?.functionId ?? sp.function ?? ''}
        groups={vocab.groups} families={vocab.families.map((f) => ({ id: f.id, label: f.label }))}
        existing={existing}
      />
    </div>
  );
}
