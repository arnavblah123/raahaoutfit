'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { functionName } from '@/lib/weddings';

export function SettingsForm({ code, colourMap, functions, requireApproval, requireGoogle, googleAvailable, requests }: {
  code: string; colourMap: boolean; functions: any[]; requireApproval: boolean; requireGoogle: boolean; googleAvailable: boolean;
  requests: { id: string; display_name: string; status: string; google: boolean }[];
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  async function patch(body: unknown) {
    setError('');
    const res = await fetch(`/api/w/${code}/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'Could not save.');
    router.refresh();
  }
  async function decide(id: string, action: 'approve' | 'reject') {
    await fetch(`/api/w/${code}/guests/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
    router.refresh();
  }
  return (
    <div className="space-y-4">
      {requests.length > 0 && (
        <div className="card space-y-2">
          <p className="font-medium">Asking to join</p>
          {requests.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
              <span>{g.display_name}{g.google && <span className="ml-2 rounded-full bg-[#e3f3ea] px-2 py-0.5 text-xs text-[#1f6143]">Google</span>}
                {g.status === 'rejected' && <span className="ml-2 text-xs text-muted">declined</span>}</span>
              <span className="flex gap-2">
                <button className="btn-primary btn-sm" onClick={() => decide(g.id, 'approve')}>Let in</button>
                {g.status === 'pending' && <button className="btn-ghost btn-sm" onClick={() => decide(g.id, 'reject')}>Decline</button>}
              </span>
            </div>
          ))}
        </div>
      )}
      <label className="card flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--color-brand)]" defaultChecked={requireApproval} onChange={(e) => patch({ require_approval: e.target.checked })} />
        <span><span className="font-medium">Approve each guest myself</span>
          <span className="block text-sm text-muted">New guests wait until you let them in. Turning this off lets in everyone who is waiting.</span></span>
      </label>
      {googleAvailable && (
        <label className="card flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--color-brand)]" defaultChecked={requireGoogle} onChange={(e) => patch({ require_google: e.target.checked })} />
          <span><span className="font-medium">Guests must sign in with Google</span>
            <span className="block text-sm text-muted">Joining with only a name is switched off. Guests already in are not affected.</span></span>
        </label>
      )}
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
