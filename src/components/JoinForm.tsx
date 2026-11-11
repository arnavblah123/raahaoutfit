'use client';
import { useState } from 'react';

export function JoinForm({ code }: { code: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError('');
    const res = await fetch(`/api/w/${code}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: new FormData(e.currentTarget).get('name') }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Something went wrong. Please try again.'); setBusy(false); return; }
    if (data.recovery) sessionStorage.setItem(`oc_recovery_${code}`, data.recovery);
    window.location.reload();
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="label" htmlFor="name">Your first name</label>
      <input id="name" name="name" className="field" required maxLength={40} autoComplete="given-name" placeholder="Only you see your results" />
      {error && <p className="err">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Joining…' : 'Join'}</button>
      <p className="text-center text-sm text-muted">No password and no OTP.</p>
    </form>
  );
}
