'use client';
import { useEffect, useState } from 'react';

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-ghost btn-sm"
      onClick={async () => { await navigator.clipboard.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? 'Copied' : label}
    </button>
  );
}

/** Share link for the host, and the personal recovery link shown once after creating or joining. */
export function LinksCard({ code, appUrl, isCreator, couple }: { code: string; appUrl: string; isCreator: boolean; couple: string }) {
  const [recovery, setRecovery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRecovery(sessionStorage.getItem(`oc_recovery_${code}`)); }, [code]);
  const share = `${appUrl}/w/${code}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`Add what you're wearing to ${couple}'s wedding so nobody clashes: ${share}`)}`;
  const link = recovery ? `${appUrl}/r/${recovery}` : null;

  async function renew() {
    setBusy(true);
    const res = await fetch(`/api/w/${code}/recovery`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (data.recovery) { sessionStorage.setItem(`oc_recovery_${code}`, data.recovery); setRecovery(data.recovery); }
    setBusy(false);
  }
  return (
    <div className="space-y-3">
      {isCreator && (
        <div className="card space-y-2">
          <p className="font-medium">Share with guests</p>
          <p className="break-all text-sm text-muted">{share}</p>
          <div className="flex gap-2">
            <a className="btn-primary btn-sm" href={wa} target="_blank" rel="noreferrer">Share on WhatsApp</a>
            <Copy text={share} label="Copy link" />
          </div>
        </div>
      )}
      <div className="card space-y-2">
        <p className="font-medium">Your personal link</p>
        {link ? (
          <>
            <p className="text-sm text-muted">Save this link. It opens your outfits on a new phone or if this browser forgets you. Do not share it.</p>
            <p className="break-all text-sm">{link}</p>
            <Copy text={link} label="Copy my link" />
          </>
        ) : (
          <>
            <p className="text-sm text-muted">Need a link that gets you back in from another phone?</p>
            <button type="button" className="btn-ghost btn-sm" onClick={renew} disabled={busy}>{busy ? 'One moment…' : 'Get my personal link'}</button>
          </>
        )}
      </div>
    </div>
  );
}
