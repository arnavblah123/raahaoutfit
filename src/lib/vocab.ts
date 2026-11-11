import { sql } from './db';

export type VocabValue = { id: string; value: string; family_id: string | null; hex: string | null };
export type VocabGroup = { id: string; key: string; label: string; free_text: boolean; values: VocabValue[] };
export type Family = { id: string; key: string; label: string; neighbour_keys: string[] };
export type Vocab = { groups: VocabGroup[]; families: Family[] };

let cache: { at: number; value: Vocab } | null = null;

export async function loadVocab(fresh = false): Promise<Vocab> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.value;
  const [g, v, families] = await Promise.all([
    sql('select id, key, label, free_text from attribute_groups order by sort'),
    sql(`select id, group_id, value, colour_family_id, swatch_hex from attribute_values
         where status = 'active' order by sort, value`),
    sql<Family>('select id, key, label, neighbour_keys from colour_families order by sort'),
  ]);
  const groups: VocabGroup[] = g.map((x) => ({
    ...x,
    values: v.filter((y) => y.group_id === x.id)
      .map((y) => ({ id: y.id, value: y.value, family_id: y.colour_family_id, hex: y.swatch_hex })),
  }));
  const value = { groups, families };
  cache = { at: Date.now(), value };
  return value;
}

export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Map a free-text value to a vocabulary id. Tolerates case and the bracketed aliases. */
export function findValue(group: VocabGroup, raw: string): VocabValue | undefined {
  const n = norm(raw);
  return group.values.find((v) => norm(v.value) === n)
    ?? group.values.find((v) => norm(v.value.replace(/\s*\(.*\)/, '')) === n);
}

/** Attribute rows -> { "Garment type": ["saree"], ... } for prompts, exports and snapshots. */
export function summarise(vocab: Vocab, rows: { group_id: string; value_id: string | null; other_text: string | null }[]) {
  const out: Record<string, string[]> = {};
  for (const g of vocab.groups) {
    const vals = rows.filter((r) => r.group_id === g.id)
      .map((r) => (r.value_id ? g.values.find((v) => v.id === r.value_id)?.value : r.other_text))
      .filter((x): x is string => !!x);
    if (vals.length) out[g.label] = vals;
  }
  return out;
}
