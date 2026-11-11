'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { functionName } from '@/lib/weddings';

export function SettingsForm({ code, colourMap, functions }: { code: string; colourMap: boolean; functions: any[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  async function patch(body: unknown) {
    setError('');
    const res = await fetch(`/api/w/${code}/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'Could not save.');
    router.refresh();
  }
  return (
    <div className="space-y-4">
      <label className="card flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--color-brand)]" defaultChecked={colourMap} onChange={(e) => patch({ colour_map_enabled: e.target.checked })} />
        <span><span className="font-medium">Colour map</span>
          <span className="block text-sm text-muted">Guests see counts by colour family for each function. No names, no photos.</span></span>
      </label>
      <div className="card space-y-2">
        <p className="font-medium">Functions</p>
        {functions.map((f) => (
          <div key={f.id} className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
            <span>{functionName(f)}</span>
            <button className="text-sm text-warn underline" onClick={() => patch({ remove_function: f.id })}>Remove</button>
          </div>
        ))}
        <div className="flex gap-2">
          <input className="field" placeholder="Add a function" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <button className="btn-ghost btn-sm shrink-0" onClick={() => { if (name.trim()) { patch({ add_function: { kind: 'custom', custom_name: name } }); setName(''); } }}>Add</button>
        </div>
      </div>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
