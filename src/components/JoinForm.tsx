'use client';
import { useState } from 'react';

/**
 * Enter the wedding after signing in. `askPhone`: signed in with Google, so we still need the number
 * to look up on the guest list. `asking`: not on the list, so this sends a request to the host.
 * With no sign-in configured (`plain`), this is the old join-by-name form.
 */
export function JoinForm({ code, name = '', askPhone = false, asking = false, plain = false }: {
  code: string; name?: string; askPhone?: boolean; asking?: boolean; plain?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError('');
    const f = new FormData(e.currentTarget);
    const res = await fetch(`/api/w/${code}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: f.get('name'), phone: f.get('phone') }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Something went wrong. Please try again.'); setBusy(false); return; }
    if (data.recovery) sessionStorage.setItem(`oc_recovery_${code}`, data.recovery);
    window.location.reload();
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="label" htmlFor="name">Your first name</label>
        <input id="name" name="name" className="field" required maxLength={40} autoComplete="given-name" defaultValue={name} placeholder="Only you see your results" />
      </div>
      {askPhone && (
        <div>
          <label className="label" htmlFor="phone">Your mobile number</label>
          <input id="phone" name="phone" className="field" type="tel" inputMode="tel" autoComplete="tel" required placeholder="98765 43210" />
          <p className="mt-1 text-sm text-muted">The host&apos;s guest list is by mobile number. Enter the number the host has for you.</p>
        </div>
      )}
      {error && <p className="err">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'One moment…' : asking ? 'Ask the host to let me in' : plain ? 'Join' : 'Continue'}</button>
    </form>
  );
}
