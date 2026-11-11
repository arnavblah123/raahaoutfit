'use client';
import { useState } from 'react';
import { signIn } from '../actions';

export default function AdminLogin() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-sm space-y-4 px-4 pt-24">
      <h1 className="text-3xl font-semibold">Admin sign-in</h1>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError('');
        const r = await signIn(String(new FormData(e.currentTarget).get('password')));
        if (r.ok) window.location.href = '/admin'; else { setError(r.error); setBusy(false); }
      }}>
        <input name="password" type="password" required className="field" placeholder="Admin password" autoComplete="current-password" />
        {error && <p className="err">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
