import { db } from './db';

export type Settings = {
  shortlist_top_k: number;
  judge_threshold: number;
  max_extra_rounds: number;
  uploads_per_guest_per_day: number;
  uploads_per_wedding_per_day: number;
  max_outfits_per_function: number;
  vocab_auto_promote_after: number;
  similar_styles_count: number;
  threshold_target_recall: number;
  judge_on_label: boolean;
  raaha_feed_url: string;
  raaha_nightly_cost_cap_usd: number;
  default_import_cost_cap_usd: number;
};
export const DEFAULTS: Settings = {
  shortlist_top_k: 5, judge_threshold: 0.6, max_extra_rounds: 2,
  uploads_per_guest_per_day: 12, uploads_per_wedding_per_day: 400,
  max_outfits_per_function: 3, vocab_auto_promote_after: 5,
  similar_styles_count: 4, threshold_target_recall: 0.98, judge_on_label: true,
  raaha_feed_url: 'https://raahabyarchanabansal.in/wp-json/wc/store/v1/products',
  raaha_nightly_cost_cap_usd: 1, default_import_cost_cap_usd: 2,
};

let cache: { at: number; value: Settings } | null = null;
export async function getSettings(fresh = false): Promise<Settings> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.value;
  const { data } = await db().from('settings').select('key,value');
  const value = { ...DEFAULTS } as any;
  for (const row of data ?? []) if (row.key in value) value[row.key] = row.value;
  cache = { at: Date.now(), value };
  return value;
}
export async function setSetting(key: keyof Settings, value: unknown) {
  await db().from('settings').upsert({ key, value, updated_at: new Date().toISOString() });
  cache = null;
}
