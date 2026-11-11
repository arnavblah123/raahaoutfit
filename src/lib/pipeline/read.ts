import { readOutfit, type Confidence, type Usage } from '../ai';
import { forModel, type Bbox } from '../images';
import { findValue, loadVocab, type Vocab } from '../vocab';

export type Suggestion = { group_id: string; group_key: string; value_ids: string[]; other: string; confidence: Confidence };
export type ReadResult = {
  notOutfit: boolean; reason: string; suggestions: Suggestion[];
  proposals: { group_id: string; value: string }[];
  photos: { bbox: Bbox; face_visible: boolean }[];
  usage: Usage;
};

/** Step 1. Attributes with low confidence come back blank, never guessed. */
export async function runRead(jpegs: Buffer[], hint?: string, given?: Vocab): Promise<ReadResult> {
  const vocab = given ?? await loadVocab();
  const { data, usage } = await readOutfit(await Promise.all(jpegs.map((j) => forModel(j))), vocab, hint);
  const suggestions: Suggestion[] = [];
  const proposals: { group_id: string; value: string }[] = [];
  for (const g of vocab.groups) {
    const entry = data.attributes.find((a) => a.group === g.key);
    const s: Suggestion = { group_id: g.id, group_key: g.key, value_ids: [], other: '', confidence: entry?.confidence ?? 'low' };
    if (entry && entry.confidence !== 'low') {
      if (g.free_text) s.other = entry.values.join(', ').slice(0, 120);
      else for (const raw of entry.values) {
        const v = findValue(g, raw);
        if (v) { if (!s.value_ids.includes(v.id)) s.value_ids.push(v.id); }
        else if (raw.trim()) proposals.push({ group_id: g.id, value: raw.trim().slice(0, 60) });
      }
    }
    suggestions.push(s);
  }
  for (const p of data.proposed_new_values ?? []) {
    const g = vocab.groups.find((x) => x.key === p.group);
    if (g && !g.free_text && p.value.trim() && !findValue(g, p.value)) proposals.push({ group_id: g.id, value: p.value.trim().slice(0, 60) });
  }
  return { notOutfit: !!data.not_an_outfit, reason: data.not_an_outfit_reason ?? '', suggestions, proposals, photos: data.photos ?? [], usage };
}
