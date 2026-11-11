'use client';
import { useEffect, useState } from 'react';
import { PhotoPicker } from './PhotoPicker';
import { embedInBrowser } from '@/lib/client/embed';
import { VERDICT_LABEL } from '@/lib/weddings';

export function OutfitActions({ code, outfitId, hasResult, unseen, verdict, request }: {
  code: string; outfitId: string; hasResult: boolean; unseen: boolean; verdict: string | null;
  request: { text: string; followup: boolean } | null;
}) {
  const base = `/api/w/${code}/outfits/${outfitId}`;
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [wrong, setWrong] = useState(false);
  const [sent, setSent] = useState(false);
  const [corrected, setCorrected] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (unseen) fetch(`${base}/seen`, { method: 'POST' }).catch(() => {}); }, [unseen, base]);

  async function addPhoto() {
    if (!photo) return;
    setBusy('Checking again…'); setError('');
    const form = new FormData(); form.set('photo', photo.blob, 'extra.jpg');
    const up = await fetch(`${base}/photos`, { method: 'POST', body: form }).catch(() => null);
    const data = await up?.json().catch(() => ({}));
    if (!up?.ok) { setError(data?.error || 'Upload failed. Please try again.'); setBusy(''); return; }
    const embeddings = await embedInBrowser(data.photos);
    const re = await fetch(`${base}/rematch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ embeddings }) }).catch(() => null);
    if (!re?.ok) { setError((await re?.json().catch(() => ({})))?.error || 'Could not check again. Please try later.'); setBusy(''); return; }
    window.location.reload();
  }
  async function sendFeedback() {
    setBusy('Sending…');
    await fetch(`${base}/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ corrected_verdict: corrected || null, note }) });
    setBusy(''); setSent(true); setWrong(false);
  }
  async function remove() {
    if (!confirm('Delete this outfit? The photos and details are removed for good.')) return;
    setBusy('Deleting…');
    const res = await fetch(base, { method: 'DELETE' });
    if (res.ok) window.location.href = `/w/${code}`; else { setError('Could not delete. Please try again.'); setBusy(''); }
  }

  return (
    <div className="space-y-4">
      {request && (
        <section className="note space-y-3">
          <p>
            <span className="font-medium">{request.followup ? 'One more photo would settle this.' : 'Please add a clearer photo.'}</span>{' '}
            We need: {request.text}.
          </p>
          <div className="w-32"><PhotoPicker label="Add photo" hint="Daylight, no flash" value={photo} onChange={setPhoto} /></div>
          {photo && <button className="btn-primary btn-sm" onClick={addPhoto} disabled={!!busy}>{busy || 'Add and check again'}</button>}
        </section>
      )}
      {error && <p className="err">{error}</p>}

      {hasResult && !sent && !wrong && <button className="block text-sm text-muted underline" onClick={() => setWrong(true)}>This result is wrong</button>}
      {sent && <p className="note">Thank you. We will review this result.</p>}
      {wrong && (
        <section className="card space-y-3">
          <p className="font-medium">What should it have said?</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(VERDICT_LABEL).filter(([k]) => k !== verdict && k !== 'possible_clash').map(([k, label]) => (
              <button key={k} className={`chip normal-case ${corrected === k ? 'chip-on' : ''}`} onClick={() => setCorrected(k)}>{label}</button>
            ))}
          </div>
          <input className="field" placeholder="Anything else? (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn-ghost btn-sm" onClick={() => setWrong(false)}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={sendFeedback} disabled={!!busy}>{busy || 'Send'}</button>
          </div>
        </section>
      )}
      <button className="block text-sm text-warn underline" onClick={remove} disabled={!!busy}>Delete this outfit</button>
    </div>
  );
}
