'use client';
import { useState } from 'react';
import { startStockJob, uploadStockOutfit } from '@/app/admin/actions';

type Group = { key: number; name: string; files: File[]; state: '' | 'uploading' | 'done' | string };

/** Shrink in the browser so each outfit stays well under the request size limit. */
async function shrink(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.82));
}

export function StockUploader() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const patch = (key: number, p: Partial<Group>) => setGroups((g) => g.map((x) => (x.key === key ? { ...x, ...p } : x)));

  function addFiles(list: FileList | null, eachIsOutfit: boolean) {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const base = Date.now();
    setGroups((g) => [...g, ...(eachIsOutfit
      ? files.map((f, i) => ({ key: base + i, name: f.name.replace(/\.\w+$/, ''), files: [f], state: '' as const }))
      : [{ key: base, name: files[0].name.replace(/\.\w+$/, ''), files: files.slice(0, 4), state: '' as const }])]);
  }
  async function uploadAll() {
    setBusy(true); setMsg('');
    let jobId = '', ok = 0;
    for (const g of groups.filter((x) => x.state !== 'done')) {
      patch(g.key, { state: 'uploading' });
      const form = new FormData();
      form.set('name', g.name); if (jobId) form.set('job_id', jobId);
      for (const f of g.files) form.append('photos', await shrink(f), 'photo.jpg');
      const r = await uploadStockOutfit(form);
      if (r.ok) { jobId = r.jobId; ok++; patch(g.key, { state: 'done' }); } else patch(g.key, { state: r.error });
    }
    if (jobId) await startStockJob(jobId);
    setBusy(false);
    setMsg(`${ok} outfit(s) uploaded. Reading and embedding has started; follow it on the Imports page.`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <label className="btn-ghost btn-sm cursor-pointer">Add one outfit (several photos)
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files, false); e.target.value = ''; }} /></label>
        <label className="btn-ghost btn-sm cursor-pointer">Add many outfits (one photo each)
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files, true); e.target.value = ''; }} /></label>
      </div>
      {groups.map((g) => (
        <div key={g.key} className="card flex flex-wrap items-center gap-3">
          <div className="flex gap-1">{g.files.map((f, i) => <img key={i} src={URL.createObjectURL(f)} alt="" className="h-20 w-14 rounded-lg object-cover" />)}</div>
          <input className="field max-w-xs" value={g.name} onChange={(e) => patch(g.key, { name: e.target.value })} placeholder="Name or SKU" />
          <label className="cursor-pointer text-sm underline">Add photo
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { patch(g.key, { files: [...g.files, ...Array.from(e.target.files ?? [])].slice(0, 4) }); e.target.value = ''; }} /></label>
          <span className={`text-sm ${g.state === 'done' ? 'text-ok' : g.state && g.state !== 'uploading' ? 'text-warn' : 'text-muted'}`}>{g.state === 'done' ? 'Uploaded' : g.state === 'uploading' ? 'Uploading…' : g.state}</span>
          {g.state !== 'done' && <button className="ml-auto text-sm text-warn underline" onClick={() => setGroups((x) => x.filter((y) => y.key !== g.key))}>Remove</button>}
        </div>
      ))}
      {groups.some((g) => g.state !== 'done') && <button className="btn-primary" disabled={busy} onClick={uploadAll}>{busy ? 'Uploading…' : `Upload ${groups.filter((g) => g.state !== 'done').length} outfit(s)`}</button>}
      {msg && <p className="note">{msg}</p>}
    </div>
  );
}
