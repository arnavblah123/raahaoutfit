'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { PhotoPicker } from './PhotoPicker';
import { embedInBrowser } from '@/lib/client/embed';
import type { VocabGroup } from '@/lib/vocab';

export type Selection = Record<string, { ids: string[]; other: string }>;
type Photo = { id: string; kind: string; url: string };
type Picked = { blob: Blob; preview: string } | null;
type Props = {
  code: string; functions: { id: string; name: string }[]; initialFunction: string;
  groups: VocabGroup[]; families: { id: string; label: string }[];
  existing?: { id: string; functionId: string; photos: Photo[]; selection: Selection; suggested: Record<string, string[]>; confirmed: boolean };
};

export function AddOutfit({ code, functions, initialFunction, groups, families, existing }: Props) {
  const [step, setStep] = useState<'photos' | 'reading' | 'confirm' | 'matching'>(existing ? 'confirm' : 'photos');
  const [functionId, setFunctionId] = useState(initialFunction || (functions.length === 1 ? functions[0].id : ''));
  const [full, setFull] = useState<Picked>(null);
  const [closeup, setCloseup] = useState<Picked>(null);
  const [extras, setExtras] = useState<Picked[]>([]);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [outfitId, setOutfitId] = useState(existing?.id ?? '');
  const [photos, setPhotos] = useState<Photo[]>(existing?.photos ?? []);
  const [sel, setSel] = useState<Selection>(existing?.selection ?? {});
  const [suggested, setSuggested] = useState<Record<string, string[]>>(existing?.suggested ?? {});
  const embeddings = useRef<Promise<Record<string, number[]>> | null>(null);

  // Start computing vectors on the phone as soon as the cropped photos exist.
  useEffect(() => {
    if (photos.length && !existing?.confirmed && !embeddings.current) embeddings.current = embedInBrowser(photos);
  }, [photos, existing]);

  async function upload() {
    if (!functionId) { setError('Pick the function this outfit is for.'); return; }
    if (!full || !closeup) { setError('Add both photos.'); return; }
    setError(''); setStep('reading');
    const form = new FormData();
    form.set('function_id', functionId);
    form.set('full', full.blob, 'full.jpg'); form.set('closeup', closeup.blob, 'closeup.jpg');
    extras.forEach((e, i) => { if (e) form.append('extra', e.blob, `extra${i}.jpg`); });
    form.set('consent', consent ? 'yes' : 'no');
    const res = await fetch(`/api/w/${code}/outfits`, { method: 'POST', body: form }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) { setError(data?.error || 'Upload failed. Check your connection and try again.'); setStep('photos'); return; }
    const colour = groups.find((g) => g.key === 'colour')!.id;
    const next: Selection = {}; const sug: Record<string, string[]> = {};
    for (const s of data.suggestions as { group_id: string; value_ids: string[]; other: string }[]) {
      sug[s.group_id] = s.value_ids;
      next[s.group_id] = { ids: s.group_id === colour ? [] : s.value_ids, other: s.other };
    }
    setOutfitId(data.outfitId); setPhotos(data.photos); setSel(next); setSuggested(sug); setStep('confirm');
    window.scrollTo(0, 0);
  }

  async function confirm() {
    const colour = groups.find((g) => g.key === 'colour')!;
    if (!sel[colour.id]?.ids.length) {
      setError('Pick the colour of your outfit from the swatches.');
      document.getElementById('colour')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    setError(''); setStep('matching');
    const vectors = embeddings.current ? await embeddings.current : {};
    const res = await fetch(`/api/w/${code}/outfits/${outfitId}/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attributes: groups.map((g) => ({ group_id: g.id, value_ids: sel[g.id]?.ids ?? [], other: sel[g.id]?.other ?? '' })),
        embeddings: vectors,
      }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) { setError(data?.error || 'Something went wrong. Please try again.'); setStep('confirm'); return; }
    window.location.href = `/w/${code}/outfit/${outfitId}`;
  }

  const toggle = (g: string, id: string) => setSel((s) => {
    const cur = s[g] ?? { ids: [], other: '' };
    return { ...s, [g]: { ...cur, ids: cur.ids.includes(id) ? cur.ids.filter((x) => x !== id) : [...cur.ids, id] } };
  });
  const setOther = (g: string, other: string) => setSel((s) => ({ ...s, [g]: { ids: s[g]?.ids ?? [], other } }));

  if (step === 'reading' || step === 'matching') {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <span className="h-10 w-10 animate-spin rounded-full border-4 border-line border-t-brand" />
        <p className="text-lg font-medium">{step === 'reading' ? 'Reading your outfit…' : 'Checking against other outfits…'}</p>
        <p className="text-sm text-muted">This can take up to a minute. Please keep this page open.</p>
      </div>
    );
  }

  if (step === 'photos') {
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-semibold">Add an outfit</h1>
        <div>
          <p className="label">Which function?</p>
          <div className="flex flex-wrap gap-2">
            {functions.map((f) => (
              <button key={f.id} type="button" className={`chip ${functionId === f.id ? 'chip-on' : ''}`} onClick={() => setFunctionId(f.id)}>{f.name}</button>
            ))}
          </div>
        </div>
        <div className="note space-y-1">
          <p className="font-medium">For a reliable result</p>
          <ul className="list-disc pl-5">
            <li>Take the photos in daylight, near a window.</li>
            <li>No flash and no filters.</li>
            <li>Your face is not needed. Crop it out, or photograph the outfit on a hanger.</li>
          </ul>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <PhotoPicker label="Full outfit" hint="Top to hem" value={full} onChange={setFull} />
          <PhotoPicker label="Close-up of the work" hint="Embroidery, print or border" value={closeup} onChange={setCloseup} />
        </div>
        <div className="space-y-2">
          <p className="text-sm"><span className="font-medium">More photos (optional).</span> <span className="text-muted">The back, the border, the blouse or the dupatta. More photos give a more accurate reading and a surer result.</span></p>
          <div className="grid grid-cols-3 gap-3">
            {[...extras, ...(extras.length < 3 ? [null] : [])].map((e, i) => (
              <PhotoPicker key={i} label="Add photo" hint="Optional" value={e}
                onChange={(v) => setExtras((cur) => { const next = [...cur]; if (v) next[i] = v; else next.splice(i, 1); return next; })} />
            ))}
          </div>
        </div>
        <div className="card space-y-2 text-sm">
          <p className="font-medium">Your photos stay private</p>
          <p className="text-muted">
            No other guest ever sees your photo or your name. We keep only a cropped picture of the outfit, remove hidden details such as location, and delete everything 7 days after the wedding. You can delete an outfit at any time. <Link href="/privacy" className="underline">Read more</Link>
          </p>
          <label className="flex items-start gap-3 pt-1">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--color-brand)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>Optional: you may keep the cropped outfit photo after the wedding to help improve matching. My name and the wedding are never kept with it.</span>
          </label>
        </div>
        {error && <p className="err">{error}</p>}
        <button className="btn-primary w-full" onClick={upload}>Continue</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-semibold">Check the details</h1>
      <p className="text-muted">We filled in what we could see. Pick the colour yourself, then correct anything that is wrong.</p>
      <div className="flex gap-2">
        {photos.map((p) => <img key={p.id} src={p.url} alt="Your outfit" className="h-28 w-20 rounded-xl object-cover" />)}
      </div>
      {groups.map((g) => g.key === 'colour'
        ? <ColourPicker key={g.id} group={g} families={families} picked={sel[g.id]?.ids ?? []} suggested={suggested[g.id] ?? []} onToggle={(id) => toggle(g.id, id)} />
        : <GroupPicker key={g.id} group={g} value={sel[g.id] ?? { ids: [], other: '' }} onToggle={(id) => toggle(g.id, id)} onOther={(t) => setOther(g.id, t)} />)}
      {error && <p className="err">{error}</p>}
      <div className="sticky bottom-3">
        <button className="btn-primary w-full shadow-lg" onClick={confirm}>{existing?.confirmed ? 'Save and check again' : 'Confirm and check for clashes'}</button>
      </div>
    </div>
  );
}

function ColourPicker({ group, families, picked, suggested, onToggle }: {
  group: VocabGroup; families: { id: string; label: string }[]; picked: string[]; suggested: string[]; onToggle: (id: string) => void;
}) {
  const guesses = group.values.filter((v) => suggested.includes(v.id));
  return (
    <section id="colour" className="card space-y-3">
      <div>
        <h2 className="text-xl font-semibold">Colour <span className="text-sm font-normal text-warn">required</span></h2>
        <p className="text-sm text-muted">Photos change colours, so please choose the real colour. Tap the main colour first; add others if the outfit has more than one.</p>
      </div>
      <div className="note space-y-2">
        {guesses.length ? (
          <>
            <p><span className="font-medium">From your photos, we think it is:</span> tap to confirm, or pick the right colour below.</p>
            <div className="flex flex-wrap gap-2">
              {guesses.map((v) => (
                <button key={v.id} type="button" onClick={() => onToggle(v.id)} aria-pressed={picked.includes(v.id)} aria-label={`Use suggested colour ${v.value}`}
                  className={`chip flex items-center gap-2 ${picked.includes(v.id) ? 'chip-on' : ''}`}>
                  <span className="h-5 w-5 rounded-full border border-black/20" style={{ background: v.hex ?? '#ccc' }} />{v.value}
                </button>
              ))}
            </div>
          </>
        ) : <p>We could not tell the colour from your photos. Please pick it below.</p>}
      </div>
      {families.map((f) => (
        <div key={f.id}>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{f.label}</p>
          <div className="grid grid-cols-5 gap-x-2 gap-y-3">
            {group.values.filter((v) => v.family_id === f.id).map((v) => {
              const on = picked.includes(v.id), hinted = suggested.includes(v.id);
              return (
                <button key={v.id} type="button" onClick={() => onToggle(v.id)} className="flex flex-col items-center gap-1" aria-pressed={on}>
                  <span style={{ background: v.hex ?? '#ccc' }}
                    className={`relative flex h-11 w-11 items-center justify-center rounded-full border ${on ? 'border-brand ring-2 ring-brand ring-offset-2' : hinted ? 'border-gold ring-2 ring-gold/60 ring-offset-1' : 'border-black/15'}`}>
                    {on && <span className="rounded-full bg-white/90 px-1 text-xs font-bold text-brand">{picked.indexOf(v.id) + 1}</span>}
                  </span>
                  <span className="text-center text-[11px] capitalize leading-tight">{v.value}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {suggested.length > 0 && <p className="text-xs text-muted">A gold ring marks our guess in the swatches above.</p>}
    </section>
  );
}

function GroupPicker({ group, value, onToggle, onOther }: {
  group: VocabGroup; value: { ids: string[]; other: string }; onToggle: (id: string) => void; onOther: (t: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = useMemo(() => {
    if (all || group.values.length <= 10) return group.values;
    const head = group.values.slice(0, 8);
    return [...head, ...group.values.filter((v) => value.ids.includes(v.id) && !head.includes(v))];
  }, [all, group.values, value.ids]);
  if (group.free_text) {
    return (
      <section className="card">
        <label className="label" htmlFor={group.id}>{group.label} <span className="font-normal">(optional)</span></label>
        <input id={group.id} className="field" value={value.other} maxLength={120} onChange={(e) => onOther(e.target.value)} />
      </section>
    );
  }
  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold">{group.label}</h2>
      <div className="flex flex-wrap gap-2">
        {shown.map((v) => (
          <button key={v.id} type="button" className={`chip ${value.ids.includes(v.id) ? 'chip-on' : ''}`} onClick={() => onToggle(v.id)}>{v.value}</button>
        ))}
        {group.values.length > 10 && (
          <button type="button" className="chip border-dashed text-muted" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${group.values.length}`}</button>
        )}
      </div>
      <input className="field" placeholder="Other (type it)" value={value.other} maxLength={120} onChange={(e) => onOther(e.target.value)} />
    </section>
  );
}
