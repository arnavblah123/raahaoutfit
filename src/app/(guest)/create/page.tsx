'use client';
import { useState } from 'react';
import { FUNCTION_KINDS, functionName } from '@/lib/weddings';

export default function CreateWedding() {
  const [picked, setPicked] = useState<string[]>(['mehendi', 'sangeet', 'wedding', 'reception']);
  const [custom, setCustom] = useState<string[]>([]);
  const [customText, setCustomText] = useState('');
  const [colourMap, setColourMap] = useState(false);
  const [approval, setApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError('');
    const f = new FormData(e.currentTarget);
    const functions = [
      ...FUNCTION_KINDS.filter((k) => k !== 'custom' && picked.includes(k)).map((kind) => ({ kind })),
      ...custom.map((custom_name) => ({ kind: 'custom', custom_name })),
    ];
    const res = await fetch('/api/weddings', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        couple_names: f.get('couple'), wedding_date: f.get('date'), city: f.get('city'),
        creator_name: f.get('name'), functions, colour_map_enabled: colourMap, require_approval: approval,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Something went wrong. Please try again.'); setBusy(false); return; }
    sessionStorage.setItem(`oc_recovery_${data.code}`, data.recovery);
    window.location.href = `/w/${data.code}`;
  }
  const addCustom = () => {
    const t = customText.trim();
    if (t && !custom.includes(t)) setCustom([...custom, t]);
    setCustomText('');
  };

  return (
    <form onSubmit={submit} className="space-y-5 pt-2">
      <h1 className="text-3xl font-semibold">Create a wedding</h1>
      <div><label className="label" htmlFor="couple">Couple</label>
        <input id="couple" name="couple" className="field" placeholder="Aanya and Kabir" required maxLength={80} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label" htmlFor="date">Wedding date</label>
          <input id="date" name="date" type="date" className="field" required /></div>
        <div><label className="label" htmlFor="city">City</label>
          <input id="city" name="city" className="field" placeholder="Jaipur" required maxLength={60} /></div>
      </div>
      <div><label className="label" htmlFor="name">Your name</label>
        <input id="name" name="name" className="field" placeholder="So guests know who set this up" required maxLength={40} /></div>

      <div>
        <p className="label">Functions</p>
        <div className="flex flex-wrap gap-2">
          {FUNCTION_KINDS.filter((k) => k !== 'custom').map((k) => (
            <button type="button" key={k} className={`chip ${picked.includes(k) ? 'chip-on' : ''}`}
              onClick={() => setPicked(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k])}>
              {functionName({ kind: k })}
            </button>
          ))}
          {custom.map((c) => (
            <button type="button" key={c} className="chip chip-on" onClick={() => setCustom(custom.filter((x) => x !== c))}>{c} ×</button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input className="field" placeholder="Add another, e.g. Pool party" value={customText} maxLength={40}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
          <button type="button" className="btn-ghost btn-sm shrink-0" onClick={addCustom}>Add</button>
        </div>
      </div>

      <label className="card flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--color-brand)]" checked={colourMap} onChange={(e) => setColourMap(e.target.checked)} />
        <span><span className="font-medium">Show a colour map</span>
          <span className="block text-sm text-muted">Guests see how many outfits are in each colour family per function. Counts only, no names or photos.</span></span>
      </label>

      <label className="card flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--color-brand)]" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
        <span><span className="font-medium">Approve each guest myself</span>
          <span className="block text-sm text-muted">Anyone who opens the link has to wait until you let them in. You only see the name they typed.</span></span>
      </label>

      {error && <p className="err">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create and get the link'}</button>
    </form>
  );
}
