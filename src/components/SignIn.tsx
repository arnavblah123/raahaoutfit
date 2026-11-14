'use client';
import { useState } from 'react';

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
    .catch(() => ({ ok: false, data: {} as any }));

/** The first screen everywhere: sign in with a mobile number (one-time code by SMS) or with Google. */
export function SignIn({ next, phone, google, failed }: { next: string; phone: boolean; google: boolean; failed?: boolean }) {
  const [number, setNumber] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(failed ? 'Google sign-in did not complete. Please try again.' : '');

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true); setError('');
    const r = await post('/api/auth/otp/send', { phone: number });
    setBusy(false);
    if (!r.ok) { setError(r.data.error || 'Something went wrong. Please try again.'); return; }
    setSentTo(r.data.phone); setCode('');
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const r = await post('/api/auth/otp/verify', { phone: sentTo, code, next });
    if (!r.ok) { setBusy(false); setError(r.data.error || 'Something went wrong. Please try again.'); return; }
    window.location.href = next;
  }

  return (
    <div className="card space-y-4">
      <p className="font-medium">Sign in to continue</p>
      {phone && !sentTo && (
        <form onSubmit={send} className="space-y-3">
          <div>
            <label className="label" htmlFor="phone">Mobile number</label>
            <input id="phone" className="field" type="tel" inputMode="tel" autoComplete="tel" required placeholder="98765 43210"
              value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send code by SMS'}</button>
        </form>
      )}
      {phone && sentTo && (
        <form onSubmit={verify} className="space-y-3">
          <div>
            <label className="label" htmlFor="otp">Enter the 6-digit code sent to {sentTo}</label>
            <input id="otp" className="field text-center text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </div>
          <button className="btn-primary w-full" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Verify and continue'}</button>
          <div className="flex justify-between text-sm">
            <button type="button" className="text-muted underline" onClick={() => { setSentTo(''); setError(''); }}>Change number</button>
            <button type="button" className="text-muted underline" onClick={() => send()} disabled={busy}>Send again</button>
          </div>
        </form>
      )}
      {error && <p className="err">{error}</p>}
      {phone && google && <p className="text-center text-sm text-muted">or</p>}
      {google && (
        <a href={`/api/auth/google/start?next=${encodeURIComponent(next)}`} className="btn-ghost w-full">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-sm font-bold text-[#4285f4]">G</span>Continue with Google
        </a>
      )}
    </div>
  );
}

/** "Signed in as …" with a way out. */
export function SignedInAs({ label }: { label: string }) {
  return (
    <p className="text-center text-xs text-muted">
      Signed in as {label} ·{' '}
      <button type="button" className="underline" onClick={async () => { await fetch('/api/auth/signout', { method: 'POST' }); window.location.href = '/'; }}>Sign out</button>
    </p>
  );
}
