import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AddOutfit, type Selection } from '@/components/AddOutfit';
import { db, guestDb } from '@/lib/db';
import { ownOutfit, signPhotos } from '@/lib/outfits';
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
  if (!guest) redirect(`/w/${code}`);
  const [vocab, { data: functions }] = await Promise.all([
    loadVocab(),
    db().from('functions').select('id,kind,custom_name').eq('wedding_id', wedding.id).order('sort'),
  ]);

  // Resuming an unfinished outfit, or editing a confirmed one.
  let existing: { id: string; functionId: string; photos: { id: string; kind: string; url: string }[]; selection: Selection; suggested: Record<string, string[]>; confirmed: boolean } | undefined;
  if (sp.outfit) {
    const outfit = await ownOutfit(guest, sp.outfit);
    if (!outfit) notFound();
    const mine = guestDb(guest);
    const [{ data: photos }, { data: attrs }] = await Promise.all([
      mine.from('outfit_photos').select('id,kind,storage_path').eq('outfit_id', outfit.id).order('created_at'),
      mine.from('outfit_attributes').select('group_id,value_id,other_text,ai_suggested,position').eq('outfit_id', outfit.id).order('position'),
    ]);
    const selection: Selection = {}; const suggested: Record<string, string[]> = {};
    const colourGroup = vocab.groups.find((g) => g.key === 'colour')!.id;
    for (const a of attrs ?? []) {
      const s = (selection[a.group_id] ??= { ids: [], other: '' });
      if (a.value_id) {
        if (a.ai_suggested) (suggested[a.group_id] ??= []).push(a.value_id);
        // Colour is never pre-selected from the AI: the guest has to pick it herself.
        if (outfit.status === 'confirmed' || a.group_id !== colourGroup) s.ids.push(a.value_id);
      } else if (a.other_text) s.other = s.other ? `${s.other}, ${a.other_text}` : a.other_text;
    }
    existing = {
      id: outfit.id, functionId: outfit.function_id, selection, suggested, confirmed: outfit.status === 'confirmed',
      photos: await signPhotos(guest, (photos ?? []).map((p: any) => ({ id: p.id, kind: p.kind, path: p.storage_path }))),
    };
  }

  return (
    <div className="space-y-4 pt-2">
      <Link href={`/w/${code}`} className="text-sm text-muted">‹ Back</Link>
      <AddOutfit
        code={code}
        functions={(functions ?? []).map((f: any) => ({ id: f.id, name: functionName(f) }))}
        initialFunction={existing?.functionId ?? sp.function ?? ''}
        groups={vocab.groups} families={vocab.families.map((f) => ({ id: f.id, label: f.label }))}
        existing={existing}
      />
    </div>
  );
}
