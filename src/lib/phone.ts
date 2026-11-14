/** Phone numbers, kept in one format everywhere: E.164 ("+919876543210"). Numbers without a country code are read as Indian. */
export function normalisePhone(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  let s = String(input).trim();
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) s = Number(s).toFixed(0);   // a spreadsheet's 9.19877E+11
  s = s.replace(/\.0+$/, '');
  const plus = s.startsWith('+') || s.startsWith('00');
  let d = s.replace(/\D/g, '');
  if (s.startsWith('00')) d = d.slice(2);
  if (!plus) {
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 10 && /^[6-9]/.test(d)) d = '91' + d;
    else if (!(d.length === 12 && /^91[6-9]/.test(d))) return null;
  }
  if (d.length < 8 || d.length > 15 || d.startsWith('0')) return null;
  if (d.startsWith('91') && !/^91[6-9]\d{9}$/.test(d)) return null;
  return '+' + d;
}

/** "+91 ••••• •3210": enough for someone to recognise their own number. */
export const maskPhone = (p: string) => `${p.slice(0, Math.max(1, p.length - 10))} ••••••${p.slice(-4)}`;

export type ListEntry = { phone: string; name: string | null };

/**
 * Turn rows from a spreadsheet, a CSV or pasted text into guest-list entries. In each row the first
 * cell that is a phone number is the number and the first other cell with letters in it is the name,
 * so the column order and any heading row do not matter.
 */
export function parseGuestRows(rows: unknown[][]): { entries: ListEntry[]; skipped: number } {
  const seen = new Map<string, ListEntry>();
  let skipped = 0;
  for (const row of rows) {
    const cells = row.map((c) => (c == null ? '' : String(c).trim())).filter(Boolean);
    if (!cells.length) continue;
    let phone: string | null = null, name: string | null = null;
    for (const c of cells) {
      const p: string | null = phone ? null : normalisePhone(c);
      if (p) phone = p;
      else if (!name && /\p{L}/u.test(c)) name = c.replace(/\s+/g, ' ').slice(0, 60);
    }
    if (!phone) { if (cells.some((c) => /\d{6,}/.test(c.replace(/\D/g, '')))) skipped++; continue; }
    if (!seen.has(phone)) seen.set(phone, { phone, name });
  }
  return { entries: [...seen.values()], skipped };
}

/** Split pasted text or a CSV file into rows of cells. */
export const textToRows = (text: string): string[][] =>
  text.split(/\r?\n/).map((line) => line.split(/[,;\t]/).map((c) => c.replace(/^"|"$/g, '')));
