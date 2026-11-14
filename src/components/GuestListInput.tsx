'use client';
import { useState } from 'react';
import { parseGuestRows, textToRows, type ListEntry } from '@/lib/phone';

/**
 * Collect guest phone numbers from an Excel or CSV file, pasted text, or the phone's contacts.
 * Everything is read on this device; only the numbers and names found are handed to onAdd.
 */
export function GuestListInput({ onAdd, busy }: { onAdd: (entries: ListEntry[]) => void | Promise<void>; busy?: boolean }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const contacts = typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window;

  async function take(rows: unknown[][]) {
    const { entries, skipped } = parseGuestRows(rows);
    if (!entries.length) { setError('No mobile numbers found there.'); setNote(''); return; }
    setError('');
    setNote(`${entries.length} ${entries.length === 1 ? 'number' : 'numbers'} read${skipped ? `, ${skipped} skipped because the number did not look right` : ''}.`);
    await onAdd(entries);
  }
  async function file(f: File | undefined) {
    if (!f) return;
    setError(''); setNote('Reading the file…');
    try {
      if (/\.xlsx$/i.test(f.name)) {
        const { default: readXlsx } = await import('read-excel-file/browser');
        const sheets = await readXlsx(f);
        await take(sheets.flatMap((s: { data: unknown[][] }) => s.data));
      } else if (/\.xls$/i.test(f.name)) {
        setNote(''); setError('This is an old-style .xls file. In Excel choose Save As and pick .xlsx or CSV, then upload that.');
      } else await take(textToRows(await f.text()));
    } catch { setNote(''); setError('That file could not be read. Save it as .xlsx or CSV and try again.'); }
  }
  async function pick() {
    try {
      const picked = await (navigator as any).contacts.select(['name', 'tel'], { multiple: true });
      await take(picked.flatMap((c: any) => (c.tel ?? []).slice(0, 1).map((t: string) => [t, c.name?.[0] ?? ''])));
    } catch { /* closed without picking */ }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <label className={`btn-ghost btn-sm cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          Upload Excel or CSV
          <input type="file" className="hidden" data-testid="guest-file" accept=".xlsx,.xls,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { file(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {contacts && <button type="button" className="btn-ghost btn-sm" onClick={pick} disabled={busy}>Pick from contacts</button>}
      </div>
      <div className="flex gap-2">
        <textarea className="field min-h-[3rem] text-sm" rows={2} placeholder="Or type or paste numbers, one per line" aria-label="Paste numbers"
          value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className="btn-ghost btn-sm shrink-0 self-start" disabled={busy || !text.trim()}
          onClick={async () => { await take(textToRows(text)); setText(''); }}>Add</button>
      </div>
      {note && <p className="text-sm text-muted">{note}</p>}
      {error && <p className="err">{error}</p>}
    </div>
  );
}
