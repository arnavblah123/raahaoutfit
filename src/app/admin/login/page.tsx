'use client';
import { useState } from 'react';
import { sendMagicLink } from '../actions';

export default function AdminLogin() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-sm space-y-4 px-4 pt-24">
      <h1 className="text-3xl font-semibold">Admin sign-in</h1>
      {sent ? <p className="note">If that address is on the admin list, a sign-in link is on its way. Open it on this device.</p> : (
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setError('');
          const r = await sendMagicLink(String(new FormData(e.currentTarget).get('email')));
          setBusy(false);
          if (r.ok) setSent(true); else setError(r.error);
        }}>
          <input name="email" type="email" required className="field" placeholder="you@example.com" autoComplete="email" />
          {error && <p className="err">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
        </form>
      )}
    </div>
  );
}
